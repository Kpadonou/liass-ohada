import { z } from "zod";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import {
  TransactionScope as Scope,
  TransactionKey as Key,
} from "./transaction-model";
import { transactionFingerprint as fingerprint } from "./transaction-repository";
const id = z.string().uuid();
export const cashSchemas = {
  DAY: c.RestaurantBusinessDaySchema,
  SESSION: c.RestaurantCashSessionSchema,
  DAY_SESSION: c.RestaurantCashSessionSchema,
  MOVEMENT: c.RestaurantCashMovementSchema,
  PAYMENT: c.RestaurantCashPaymentFactSchema,
  ACTIVE_DAY: z.object({ businessDayId: id }).strict(),
  ACTIVE_CASHIER: z
    .object({ cashSessionId: id, cashierUserId: z.string().min(1) })
    .strict(),
  HISTORY: z
    .object({ businessDayId: id, openedAt: z.string().datetime() })
    .strict(),
  COMMAND: z
    .object({
      command: z.string(),
      ownerId: z.string(),
      lookupHash: z.string().regex(/^[a-f0-9]{64}$/),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      actorId: z.string(),
      committedAt: z.string().datetime(),
      result: z.union([
        c.RestaurantBusinessDaySchema,
        c.RestaurantCashSessionSchema,
        c.RestaurantCashMovementSchema,
      ]),
    })
    .strict(),
};
type Kind = keyof typeof cashSchemas;
type Data<T extends Kind> = z.infer<(typeof cashSchemas)[T]>;
export type CashRow<T extends Kind> = Key &
  Scope & { entityType: string; schemaVersion: 1; data: Data<T> };
export const cashError = (
  code = "RESTAURANTS_CASH_CONFLICT",
  status = 409,
): never => {
  throw new AppError(status, code);
};
export class RestaurantCashRepository {
  static key<T extends Kind>(scope: Scope, kind: T, value: Data<T>): Key {
    const d = value as Data<Kind>;
    const meta = K.restaurantTransactionMetaSK();
    if (kind === "COMMAND" && "lookupHash" in d)
      return {
        PK: K.restaurantTransactionCommandPK(
          scope.orgId,
          scope.outletId,
          d.command,
          d.ownerId,
          d.lookupHash,
        ),
        SK: K.restaurantTransactionCommandSK(d.ownerId, d.lookupHash),
      };
    if (kind === "ACTIVE_CASHIER" && "cashierUserId" in d)
      return K.restaurantActiveCashierKey(
        scope.orgId,
        scope.outletId,
        d.cashierUserId,
      );
    if (kind === "ACTIVE_DAY")
      return {
        PK: K.restaurantBusinessDaysPK(scope.orgId, scope.outletId),
        SK: K.restaurantOccupancySK(),
      };
    if (kind === "HISTORY" && "openedAt" in d && "businessDayId" in d)
      return {
        PK: K.restaurantBusinessDaysPK(scope.orgId, scope.outletId),
        SK: K.restaurantBusinessDayHistorySK(d.openedAt, d.businessDayId),
      };
    if (kind === "DAY" && "businessDayId" in d)
      return {
        PK: K.restaurantBusinessDayPK(
          scope.orgId,
          scope.outletId,
          d.businessDayId,
        ),
        SK: meta,
      };
    if (kind === "DAY_SESSION" && "cashSessionId" in d && "openedAt" in d)
      return {
        PK: K.restaurantBusinessDayPK(
          scope.orgId,
          scope.outletId,
          d.businessDayId,
        ),
        SK: K.restaurantCashSessionSK(d.openedAt, d.cashSessionId),
      };
    if ("cashSessionId" in d) {
      const PK = K.restaurantCashSessionPK(
        scope.orgId,
        scope.outletId,
        d.cashSessionId,
      );
      if (kind === "SESSION") return { PK, SK: meta };
      if (kind === "MOVEMENT" && "movementId" in d)
        return {
          PK,
          SK: K.restaurantCashMovementSK(d.occurredAt, d.movementId),
        };
      if (kind === "PAYMENT" && "paymentId" in d)
        return {
          PK,
          SK: K.restaurantPaymentReferenceSK(d.capturedAt, d.paymentId),
        };
    }
    return cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
  }
  static row<T extends Kind>(scope: Scope, kind: T, data: Data<T>): CashRow<T> {
    const parsed = cashSchemas[kind].parse(data) as Data<T>;
    if (
      "orgId" in parsed &&
      (parsed.orgId !== scope.orgId || parsed.outletId !== scope.outletId)
    )
      cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
    if (
      "result" in parsed &&
      (parsed.result.orgId !== scope.orgId ||
        parsed.result.outletId !== scope.outletId)
    )
      cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
    return {
      ...this.key(scope, kind, parsed),
      ...scope,
      schemaVersion: 1,
      entityType: `RESTAURANT_CASH_${kind}`,
      data: parsed,
    };
  }
  static decode<T extends Kind>(
    scope: Scope,
    key: Key,
    kind: T,
    raw: unknown,
  ): CashRow<T> {
    const schema = z
      .object({
        PK: z.string(),
        SK: z.string(),
        orgId: z.literal(scope.orgId),
        outletId: z.literal(scope.outletId),
        schemaVersion: z.literal(1),
        entityType: z.literal(`RESTAURANT_CASH_${kind}`),
        data: cashSchemas[kind],
      })
      .strict();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
    const row = parsed.data as CashRow<T>;
    const expected = this.row(scope, kind, row.data);
    if (
      key.PK !== row.PK ||
      key.SK !== row.SK ||
      row.PK !== expected.PK ||
      row.SK !== expected.SK
    )
      cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
    return row;
  }
  static async get<T extends Kind>(
    scope: Scope,
    key: Key,
    kind: T,
  ): Promise<CashRow<T> | undefined> {
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      )
    )
      return cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    return result.Item
      ? this.decode(scope, key, kind, unmarshall(result.Item))
      : undefined;
  }
  static conditions<T extends Kind>(row: CashRow<T>) {
    const version = "version" in row.data ? row.data.version : undefined;
    const target =
      "cashSessionId" in row.data
        ? row.data.cashSessionId
        : "businessDayId" in row.data
          ? row.data.businessDayId
          : undefined;
    const targetField =
      "cashSessionId" in row.data ? "cashSessionId" : "businessDayId";
    return {
      ConditionExpression:
        "entityType = :type AND orgId = :org AND outletId = :out" +
        (version === undefined ? "" : " AND #data.#version = :version") +
        (target ? " AND #data.#target = :target" : ""),
      ExpressionAttributeNames: {
        ...(version === undefined
          ? {}
          : { "#data": "data", "#version": "version" }),
        ...(target ? { "#data": "data", "#target": targetField } : {}),
      },
      ExpressionAttributeValues: marshall({
        ":type": row.entityType,
        ":org": row.orgId,
        ":out": row.outletId,
        ...(version === undefined ? {} : { ":version": version }),
        ...(target ? { ":target": target } : {}),
      }),
    };
  }
  static put<T extends Kind>(
    row: CashRow<T>,
    previous?: CashRow<T>,
  ): TransactWriteItem {
    if (
      previous &&
      (![
        "RESTAURANT_CASH_DAY",
        "RESTAURANT_CASH_SESSION",
        "RESTAURANT_CASH_DAY_SESSION",
      ].includes(row.entityType) ||
        ("status" in previous.data && previous.data.status !== "OPEN") ||
        row.PK !== previous.PK ||
        row.SK !== previous.SK)
    )
      return cashError();
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(row, { removeUndefinedValues: true }),
        ...(previous
          ? this.conditions(previous)
          : {
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            }),
      },
    };
  }
  static remove(
    row: CashRow<"ACTIVE_DAY"> | CashRow<"ACTIVE_CASHIER">,
  ): TransactWriteItem {
    if (
      ![
        "RESTAURANT_CASH_ACTIVE_DAY",
        "RESTAURANT_CASH_ACTIVE_CASHIER",
      ].includes(row.entityType)
    )
      return cashError();
    return {
      Delete: {
        TableName: restaurantsTableName(),
        Key: marshall({ PK: row.PK, SK: row.SK }),
        ...this.conditions(row),
      },
    };
  }
  static async page<
    T extends "HISTORY" | "DAY_SESSION" | "MOVEMENT" | "PAYMENT",
  >(
    scope: Scope,
    pk: string,
    prefix: string,
    kind: T,
    input: z.infer<typeof c.RestaurantCashListRequestSchema>,
    actorScope: string,
    descending = false,
  ) {
    const request = c.RestaurantCashListRequestSchema.parse(input);
    const digest = fingerprint([
      scope,
      pk,
      prefix,
      kind,
      actorScope,
      descending,
    ]);
    let start: Key | undefined;
    const sort = (timestamp: string, id: string) =>
      kind === "HISTORY"
        ? K.restaurantBusinessDayHistorySK(timestamp, id)
        : kind === "DAY_SESSION"
          ? K.restaurantCashSessionSK(timestamp, id)
          : kind === "PAYMENT"
            ? K.restaurantPaymentReferenceSK(timestamp, id)
            : K.restaurantCashMovementSK(timestamp, id);
    if (request.cursor) {
      try {
        const value = z
          .object({
            scope: z.literal(digest),
            timestamp: z.string().datetime(),
            id,
          })
          .strict()
          .parse(
            JSON.parse(
              Buffer.from(request.cursor, "base64url").toString("utf8"),
            ),
          );
        start = { PK: pk, SK: sort(value.timestamp, value.id) };
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    if (
      !pk.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      )
    )
      return cashError();
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": pk, ":prefix": prefix }),
        ConsistentRead: true,
        Limit: request.limit,
        ExclusiveStartKey: start ? marshall(start) : undefined,
        ScanIndexForward: !descending,
      }),
    );
    const rows = (response.Items ?? []).map((raw) => {
      const data = unmarshall(raw);
      if (
        data.PK !== pk ||
        typeof data.SK !== "string" ||
        !data.SK.startsWith(prefix)
      )
        return cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
      return this.decode(scope, { PK: pk, SK: data.SK }, kind, data);
    });
    let nextCursor: string | undefined;
    if (response.LastEvaluatedKey) {
      const k = unmarshall(response.LastEvaluatedKey);
      const logical = typeof k.SK === "string" ? k.SK.slice(prefix.length) : "";
      const timestamp = logical.slice(0, 24),
        rowId = logical.slice(25);
      if (k.PK !== pk || k.SK !== sort(timestamp, id.parse(rowId)))
        return cashError("RESTAURANTS_TRANSACTION_INTEGRITY");
      nextCursor = Buffer.from(
        JSON.stringify({ scope: digest, timestamp, id: rowId }),
      ).toString("base64url");
    }
    return { rows, nextCursor };
  }
}
