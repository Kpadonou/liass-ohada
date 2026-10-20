import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import { TransactionScope } from "./transaction-model";
import { ReceiptStoredSchemas } from "./receipt-model";
import { transactionFingerprint as hash } from "./transaction-repository";
export type ReceiptKind = keyof typeof ReceiptStoredSchemas;
export class RestaurantReceiptRepository {
  static row(
    scope: TransactionScope,
    receiptId: string,
    sk: string,
    kind: ReceiptKind,
    data: unknown,
  ) {
    return {
      PK: K.restaurantBillPK(scope.orgId, scope.outletId, receiptId),
      SK: sk,
      orgId: scope.orgId,
      outletId: scope.outletId,
      schemaVersion: 1,
      entityType: `RESTAURANT_BILL_${kind}`,
      data: ReceiptStoredSchemas[kind].parse(data),
    };
  }
  static decode<T extends ReceiptKind>(
    scope: TransactionScope,
    receiptId: string,
    sk: string,
    kind: T,
    raw: Record<string, unknown>,
  ): z.infer<(typeof ReceiptStoredSchemas)[T]> {
    if (
      raw.PK !== K.restaurantBillPK(scope.orgId, scope.outletId, receiptId) ||
      raw.SK !== sk ||
      raw.orgId !== scope.orgId ||
      raw.outletId !== scope.outletId ||
      raw.entityType !== `RESTAURANT_BILL_${kind}` ||
      raw.schemaVersion !== 1
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (
      kind === "PART" &&
      Buffer.byteLength(JSON.stringify(raw), "utf8") > 64 * 1024
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const data = ReceiptStoredSchemas[kind].parse(raw.data);
    if ("number" in data && sk !== K.restaurantBillPartSK(data.number))
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if ("receiptId" in data && data.receiptId !== receiptId)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return data as z.infer<(typeof ReceiptStoredSchemas)[T]>;
  }
  static async get<T extends ReceiptKind>(
    scope: TransactionScope,
    receiptId: string,
    sk: string,
    kind: T,
  ) {
    const r = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall({
          PK: K.restaurantBillPK(scope.orgId, scope.outletId, receiptId),
          SK: sk,
        }),
        ConsistentRead: true,
      }),
    );
    return r.Item
      ? this.decode(scope, receiptId, sk, kind, unmarshall(r.Item))
      : undefined;
  }
  static put(
    scope: TransactionScope,
    receiptId: string,
    sk: string,
    kind: ReceiptKind,
    data: unknown,
    previousVersion?: number,
  ): TransactWriteItem {
    if (previousVersion !== undefined && kind !== "MANIFEST")
      throw new AppError(409, "RESTAURANTS_TRANSACTION_STATE");
    const row = this.row(scope, receiptId, sk, kind, data);
    if (
      kind === "PART" &&
      Buffer.byteLength(JSON.stringify(row), "utf8") > 64 * 1024
    )
      throw new AppError(400, "RESTAURANTS_TRANSACTION_LIMIT");
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(row, {
          removeUndefinedValues: true,
        }),
        ConditionExpression:
          previousVersion === undefined
            ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            : "entityType = :type AND #d.#v = :v AND #d.#s = :building",
        ...(previousVersion === undefined
          ? {}
          : {
              ExpressionAttributeNames: {
                "#d": "data",
                "#v": "version",
                "#s": "state",
              },
              ExpressionAttributeValues: marshall({
                ":type": "RESTAURANT_BILL_MANIFEST",
                ":v": previousVersion,
                ":building": "BUILDING",
              }),
            }),
      },
    };
  }
  static commandKey(
    scope: TransactionScope,
    sessionId: string,
    clientRequestId: string,
  ) {
    const digest = hash([scope, "PUBLISH_RECEIPT", sessionId, clientRequestId]);
    return {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        "PUBLISH_RECEIPT",
        sessionId,
        digest,
      ),
      SK: K.restaurantTransactionCommandSK(sessionId, digest),
    };
  }
  static async command(
    scope: TransactionScope,
    sessionId: string,
    clientRequestId: string,
  ) {
    const key = this.commandKey(scope, sessionId, clientRequestId);
    const r = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    if (!r.Item) return undefined;
    const raw = unmarshall(r.Item);
    if (
      raw.PK !== key.PK ||
      raw.SK !== key.SK ||
      raw.orgId !== scope.orgId ||
      raw.outletId !== scope.outletId ||
      raw.entityType !== "RESTAURANT_BILL_COMMAND"
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return ReceiptStoredSchemas.COMMAND.parse(raw.data);
  }
  static commandPut(
    scope: TransactionScope,
    sessionId: string,
    clientRequestId: string,
    data: unknown,
  ): TransactWriteItem {
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall({
          ...this.commandKey(scope, sessionId, clientRequestId),
          orgId: scope.orgId,
          outletId: scope.outletId,
          schemaVersion: 1,
          entityType: "RESTAURANT_BILL_COMMAND",
          data: ReceiptStoredSchemas.COMMAND.parse(data),
        }),
        ConditionExpression:
          "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    };
  }
  static async parts(
    scope: TransactionScope,
    receiptId: string,
    root: string,
    partCount: number,
    input: { limit: number; cursor?: string },
  ) {
    let after = 0;
    const scopeHash = hash([scope, receiptId, root, "RECEIPT_PARTS"]);
    if (input.cursor) {
      try {
        const c = z
          .object({
            scope: z.literal(scopeHash),
            after: z.number().int().min(1).max(partCount),
          })
          .strict()
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
        after = c.after;
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const pk = K.restaurantBillPK(scope.orgId, scope.outletId, receiptId);
    const r = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        ConsistentRead: true,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": pk,
          ":prefix": K.restaurantBillPartPrefix(),
        }),
        Limit: input.limit,
        ...(after
          ? {
              ExclusiveStartKey: marshall({
                PK: pk,
                SK: K.restaurantBillPartSK(after),
              }),
            }
          : {}),
      }),
    );
    const parts = (r.Items ?? []).map((raw, index) =>
      this.decode(
        scope,
        receiptId,
        K.restaurantBillPartSK(after + index + 1),
        "PART",
        unmarshall(raw),
      ),
    );
    if (parts.length === 0 && after < partCount)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    for (const [index, part] of parts.entries()) {
      if (
        hash([part.previousDigest, part.number, part.content]) !==
          part.digest ||
        (index > 0 && part.previousDigest !== parts[index - 1].digest)
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    }
    const last = after + parts.length;
    if (
      last === partCount &&
      parts.length &&
      parts[parts.length - 1].digest !== root
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    if (last > partCount)
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return {
      parts,
      ...(last < partCount
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ scope: scopeHash, after: last }),
            ).toString("base64url"),
          }
        : {}),
    };
  }
}
