import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { z } from "zod";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import { RestaurantCashService as Cash } from "./cash-service";
import { TransactionScope as Scope } from "./transaction-model";
import { transactionFingerprint as hash } from "./transaction-repository";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const month = (at: string) => at.slice(0, 7).replace("-", "");
const key = (s: Scope, kind: "INV" | "CN", at: string, id: string) => ({
  PK: K.restaurantDocumentsPK(s.orgId, s.outletId, month(at)),
  SK: K.restaurantDocumentSK(kind, at, id),
});
const fail = (): never => {
  throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
};
export class RestaurantDocumentCollections {
  static put(
    s: Scope,
    kind: "INV" | "CN",
    at: string,
    id: string,
    data: unknown,
  ): TransactWriteItem {
    const schema =
      kind === "INV"
        ? c.RestaurantInvoiceCollectionRowSchema
        : c.RestaurantCreditNoteCollectionRowSchema;
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall({
          ...key(s, kind, at, id),
          ...s,
          entityType: `RESTAURANT_DOCUMENT_${kind}`,
          schemaVersion: 1,
          data: schema.parse(data),
        }),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    };
  }
  static async context(s: Scope) {
    const active = await Cash.activeDay(s);
    const pointerKey = {
      PK: K.restaurantBusinessDaysPK(s.orgId, s.outletId),
      SK: K.restaurantOccupancySK(),
    };
    const actions: TransactWriteItem[] = [
      {
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall(pointerKey),
          ConditionExpression: active
            ? "#d.#id = :id"
            : "attribute_not_exists(PK)",
          ...(active
            ? {
                ExpressionAttributeNames: {
                  "#d": "data",
                  "#id": "businessDayId",
                },
                ExpressionAttributeValues: marshall({
                  ":id": active.day.data.businessDayId,
                }),
              }
            : {}),
        },
      },
    ];
    if (active)
      actions.push({
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall({ PK: active.day.PK, SK: active.day.SK }),
          ConditionExpression: "#d.#v = :v AND #d.#s = :s",
          ExpressionAttributeNames: {
            "#d": "data",
            "#v": "version",
            "#s": "status",
          },
          ExpressionAttributeValues: marshall({
            ":v": active.day.data.version,
            ":s": "OPEN",
          }),
        },
      });
    return { businessDayId: active?.day.data.businessDayId ?? null, actions };
  }
  static locator(
    s: Scope,
    creditNoteId: string,
    at: string,
  ): TransactWriteItem {
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall({
          PK: K.restaurantCreditNotePK(s.orgId, s.outletId, creditNoteId),
          SK: K.restaurantCreditDocumentLocatorSK(),
          ...s,
          entityType: "RESTAURANT_DOCUMENT_LOCATOR",
          schemaVersion: 1,
          data: { ...key(s, "CN", at, creditNoteId) },
        }),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    };
  }
  static async refundWrite(
    s: Scope,
    creditNoteId: string,
    before: number,
    after: number,
    amount: number,
  ): Promise<TransactWriteItem[]> {
    const r = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall({
          PK: K.restaurantCreditNotePK(s.orgId, s.outletId, creditNoteId),
          SK: K.restaurantCreditDocumentLocatorSK(),
        }),
        ConsistentRead: true,
      }),
    );
    if (!r.Item) return []; // Historical CreditNote: no projection, no write-on-read.
    const locator = unmarshall(r.Item);
    if (
      locator.orgId !== s.orgId ||
      locator.outletId !== s.outletId ||
      locator.entityType !== "RESTAURANT_DOCUMENT_LOCATOR"
    )
      fail();
    const target = z
      .object({ PK: z.string(), SK: z.string() })
      .strict()
      .parse(locator.data);
    if (
      !target.PK.startsWith(
        `${K.restaurantTransactionScope(s.orgId, s.outletId)}#DOCS#`,
      ) ||
      !target.SK.endsWith(`#${creditNoteId}`)
    )
      fail();
    const projection = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(target),
        ConsistentRead: true,
      }),
    );
    if (!projection.Item) return fail();
    const row = unmarshall(projection.Item);
    const data = c.RestaurantCreditNoteCollectionRowSchema.parse(row.data);
    if (
      row.orgId !== s.orgId ||
      row.outletId !== s.outletId ||
      row.entityType !== "RESTAURANT_DOCUMENT_CN" ||
      data.creditNoteId !== creditNoteId ||
      data.amountMinor !== amount
    )
      fail();
    return [
      {
        Put: {
          TableName: restaurantsTableName(),
          Item: marshall({
            ...row,
            data: c.RestaurantCreditNoteCollectionRowSchema.parse({
              ...data,
              refundedMinor: after,
              remainingRefundableMinor: amount - after,
            }),
          }),
          ConditionExpression: "#d.#r = :before AND #d.#amount = :amount",
          ExpressionAttributeNames: {
            "#d": "data",
            "#r": "refundedMinor",
            "#amount": "amountMinor",
          },
          ExpressionAttributeValues: marshall({
            ":before": before,
            ":amount": amount,
          }),
        },
      },
    ];
  }
  static async list(
    s: Scope,
    actor: string,
    kind: "INV" | "CN",
    input: unknown,
  ) {
    await Cash.authorize(s, actor);
    const request = c.RestaurantDocumentCollectionRequestSchema.parse(input);
    request.from = new Date(request.from).toISOString();
    request.to = new Date(request.to).toISOString();
    const q = normalize(request.q ?? "");
    const fingerprint = hash([
      s,
      actor,
      kind,
      request.from,
      request.to,
      request.businessDayId ?? null,
      q,
      request.limit,
    ]);
    const months: string[] = [];
    const date = new Date(request.to);
    date.setUTCDate(1);
    while (month(date.toISOString()) >= month(request.from)) {
      months.push(month(date.toISOString()));
      date.setUTCMonth(date.getUTCMonth() - 1);
    }
    let index = 0,
      position: Record<string, unknown> | undefined;
    if (request.cursor) {
      try {
        const cursor = z
          .object({
            fingerprint: z.string(),
            index: z.number().int().nonnegative(),
            position: z.record(z.string(), z.unknown()).optional(),
          })
          .strict()
          .parse(
            JSON.parse(Buffer.from(request.cursor, "base64url").toString()),
          );
        if (cursor.fingerprint !== fingerprint || cursor.index >= months.length)
          fail();
        index = cursor.index;
        position = cursor.position;
      } catch {
        throw new AppError(400, "ERROR_INVALID_INPUT");
      }
    }
    const items: unknown[] = [];
    let evaluated = 0;
    while (
      index < months.length &&
      items.length < request.limit &&
      evaluated < 500
    ) {
      const PK = K.restaurantDocumentsPK(s.orgId, s.outletId, months[index]);
      if (
        position &&
        (position.PK !== PK ||
          typeof position.SK !== "string" ||
          !position.SK.startsWith(`${kind}#`))
      )
        fail();
      const r = await dynamoClient.send(
        new QueryCommand({
          TableName: restaurantsTableName(),
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
          ExpressionAttributeValues: marshall({
            ":pk": PK,
            ":from": `${kind}#${request.from}`,
            ":to": `${kind}#${request.to}#\uffff`,
          }),
          ScanIndexForward: false,
          ConsistentRead: true,
          Limit: Math.min(request.limit - items.length, 500 - evaluated),
          ...(position ? { ExclusiveStartKey: marshall(position) } : {}),
        }),
      );
      evaluated += r.ScannedCount ?? r.Items?.length ?? 0;
      for (const raw of r.Items ?? []) {
        const row = unmarshall(raw);
        if (
          row.orgId !== s.orgId ||
          row.outletId !== s.outletId ||
          row.entityType !== `RESTAURANT_DOCUMENT_${kind}`
        )
          fail();
        const data = (
          kind === "INV"
            ? c.RestaurantInvoiceCollectionRowSchema
            : c.RestaurantCreditNoteCollectionRowSchema
        ).parse(row.data);
        if (
          request.businessDayId &&
          data.businessDayId !== request.businessDayId
        )
          continue;
        const search = [
          data.invoiceId,
          data.tableDisplayName,
          ...("creditNoteReference" in data
            ? [data.creditNoteReference, data.reason]
            : []),
        ].join(" ");
        if (!q || normalize(search).includes(q)) items.push(data);
      }
      position = r.LastEvaluatedKey
        ? unmarshall(r.LastEvaluatedKey)
        : undefined;
      if (!position) index++;
    }
    return {
      items,
      ...(index < months.length
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ fingerprint, index, position }),
            ).toString("base64url"),
          }
        : {}),
    };
  }
}
