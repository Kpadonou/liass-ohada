import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import { TransactionScope } from "./transaction-model";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { transactionFingerprint as hash } from "./transaction-repository";
import {
  RestaurantNonnegativeQuantitySchema,
  RestaurantQuantitySchema,
} from "@liass-ohada/shared/restaurant-quantity";

export type CreditKey = { PK: string; SK: string };
export const CreditControlSchema = z
  .object({
    finalBillId: z.string().uuid(),
    sourceReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    originalAmountMinor: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    creditedMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    version: z.number().int().positive(),
    originalQuantity: RestaurantQuantitySchema.optional(),
    creditedQuantity: RestaurantNonnegativeQuantitySchema.optional(),
  })
  .strict();
export class RestaurantCreditNoteRepository {
  static row(
    scope: TransactionScope,
    key: CreditKey,
    entityType: string,
    data: unknown,
  ) {
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(scope.orgId, scope.outletId) + "#",
      )
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return { ...key, ...scope, schemaVersion: 1, entityType, data };
  }
  static decode<T>(
    scope: TransactionScope,
    key: CreditKey,
    entityType: string,
    schema: z.ZodType<T>,
    raw: Record<string, unknown>,
  ): T {
    if (
      raw.PK !== key.PK ||
      raw.SK !== key.SK ||
      raw.orgId !== scope.orgId ||
      raw.outletId !== scope.outletId ||
      raw.entityType !== entityType ||
      raw.schemaVersion !== 1
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const data = schema.parse(raw.data);
    if (
      typeof data === "object" &&
      data !== null &&
      "creditNoteId" in data &&
      typeof data.creditNoteId === "string"
    ) {
      const creditPK = K.restaurantCreditNotePK(
        scope.orgId,
        scope.outletId,
        data.creditNoteId,
      );
      if (
        entityType === "RESTAURANT_CREDIT_NOTE" &&
        (key.PK !== creditPK || key.SK !== "META")
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      if (
        entityType === "RESTAURANT_CREDIT_NOTE_LINE" &&
        "orderId" in data &&
        "itemId" in data &&
        (key.PK !== creditPK ||
          key.SK !==
            K.restaurantCreditNoteLineSK(
              String(data.orderId),
              String(data.itemId),
            ))
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      if (
        (entityType === "RESTAURANT_CREDIT_NOTE" ||
          entityType === "RESTAURANT_CREDIT_NOTE_SUMMARY") &&
        "orgId" in data &&
        "outletId" in data &&
        (data.orgId !== scope.orgId || data.outletId !== scope.outletId)
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    }
    return data;
  }
  static async get<T>(
    scope: TransactionScope,
    key: CreditKey,
    type: string,
    schema: z.ZodType<T>,
  ) {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    return response.Item
      ? this.decode(scope, key, type, schema, unmarshall(response.Item))
      : undefined;
  }
  static put(
    scope: TransactionScope,
    key: CreditKey,
    type: string,
    data: unknown,
    previousVersion?: number,
  ): TransactWriteItem {
    if (previousVersion !== undefined && type !== "RESTAURANT_CREDIT_CONTROL")
      throw new AppError(409, "RESTAURANTS_TRANSACTION_STATE");
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(this.row(scope, key, type, data), {
          removeUndefinedValues: true,
        }),
        ConditionExpression:
          previousVersion === undefined
            ? "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            : "entityType = :type AND #d.#v = :version",
        ...(previousVersion === undefined
          ? {}
          : {
              ExpressionAttributeNames: { "#d": "data", "#v": "version" },
              ExpressionAttributeValues: marshall({
                ":type": type,
                ":version": previousVersion,
              }),
            }),
      },
    };
  }
  static async page<T>(
    scope: TransactionScope,
    actorId: string,
    pk: string,
    prefix: string,
    type: string,
    schema: z.ZodType<T>,
    input: { limit: number; cursor?: string },
  ) {
    const identity = hash([scope, actorId, pk, prefix]);
    let start: CreditKey | undefined;
    if (input.cursor) {
      try {
        const decoded = z
          .object({
            scope: z.literal(identity),
            sk: z.string().startsWith(prefix),
          })
          .strict()
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
        start = { PK: pk, SK: decoded.sk };
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": pk, ":prefix": prefix }),
        Limit: input.limit,
        ConsistentRead: true,
        ScanIndexForward: false,
        ExclusiveStartKey: start ? marshall(start) : undefined,
      }),
    );
    const items = (result.Items ?? []).map((item) => {
      const raw = unmarshall(item);
      return this.decode(
        scope,
        { PK: pk, SK: String(raw.SK) },
        type,
        schema,
        raw,
      );
    });
    const last = result.LastEvaluatedKey
      ? unmarshall(result.LastEvaluatedKey)
      : undefined;
    if (
      last &&
      (last.PK !== pk ||
        typeof last.SK !== "string" ||
        !last.SK.startsWith(prefix))
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return {
      items,
      ...(last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ scope: identity, sk: last.SK }),
            ).toString("base64url"),
          }
        : {}),
    };
  }
  static budget(actions: TransactWriteItem[]) {
    const bytes = Buffer.byteLength(JSON.stringify({ TransactItems: actions }));
    if (actions.length > 100 || bytes > 3 * 1024 * 1024)
      throw new AppError(400, "RESTAURANTS_CREDIT_LIMIT");
    for (const action of actions)
      if (
        action.Put &&
        Buffer.byteLength(JSON.stringify(action.Put.Item)) > 350 * 1024
      )
        throw new AppError(400, "RESTAURANTS_CREDIT_LIMIT");
    return { operations: actions.length, serializedBytes: bytes };
  }
  static async commit(actions: TransactWriteItem[]) {
    this.budget(actions);
    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: actions }),
    );
  }
}
