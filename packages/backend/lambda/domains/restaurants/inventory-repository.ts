import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import { InventoryScope, InventoryScopeSchema } from "./inventory-model";
export type InventoryKey = { PK: string; SK: string };
/** Inventory-owned adapter. No update/delete operation exists for movement history. */
export class InventoryRepository {
  static itemKey(s: InventoryScope, id: string): InventoryKey {
    return {
      PK: K.restaurantStockPK(s.orgId, s.outletId),
      SK: K.restaurantStockSK(id),
    };
  }
  static decode<T>(
    s: InventoryScope,
    key: InventoryKey,
    type: string,
    schema: z.ZodType<T>,
    raw: Record<string, AttributeValue>,
  ): T {
    const row = unmarshall(raw);
    if (
      row.PK !== key.PK ||
      row.SK !== key.SK ||
      row.orgId !== s.orgId ||
      row.outletId !== s.outletId ||
      row.entityType !== type
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const data = schema.parse(row.data);
    const scoped = z.object({
      orgId: z.literal(s.orgId),
      outletId: z.literal(s.outletId),
    });
    if (type === "RESTAURANT_INVENTORY_COMMAND") {
      scoped.parse(z.object({ movement: scoped }).parse(data).movement);
    } else {
      scoped.parse(data);
    }
    let expected: InventoryKey | undefined;
    if (type === "RESTAURANT_STOCK_ITEM") {
      const identity = z.object({ id: z.string().uuid() }).parse(data);
      expected = this.itemKey(s, identity.id);
    } else if (type === "RESTAURANT_STOCK_MOVEMENT") {
      const identity = z
        .object({
          id: z.string().uuid(),
          stockItemId: z.string().uuid(),
          createdAt: z.string().datetime(),
        })
        .parse(data);
      expected = {
        PK: K.restaurantStockHistoryPK(
          s.orgId,
          s.outletId,
          identity.stockItemId,
        ),
        SK: K.restaurantStockMovementSK(identity.createdAt, identity.id),
      };
    } else if (type === "RESTAURANT_STOCK_MAPPING") {
      const identity = z.object({ menuItemId: z.string().uuid() }).parse(data);
      expected = {
        PK: K.restaurantStockPK(s.orgId, s.outletId),
        SK: K.restaurantStockMappingSK(identity.menuItemId),
      };
    }
    if (expected && (expected.PK !== key.PK || expected.SK !== key.SK))
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return data;
  }
  static async get<T>(
    s: InventoryScope,
    key: InventoryKey,
    type: string,
    schema: z.ZodType<T>,
  ): Promise<T | undefined> {
    InventoryScopeSchema.parse(s);
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(s.orgId, s.outletId) + "#",
      )
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const r = await dynamoClient.send(
      new GetItemCommand({
        TableName: restaurantsTableName(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    return r.Item ? this.decode(s, key, type, schema, r.Item) : undefined;
  }
  static put(
    s: InventoryScope,
    key: InventoryKey,
    type: string,
    data: unknown,
    version?: number,
  ): TransactWriteItem {
    InventoryScopeSchema.parse(s);
    if (
      !key.PK.startsWith(
        K.restaurantTransactionScope(s.orgId, s.outletId) + "#",
      ) ||
      (version !== undefined && type !== "RESTAURANT_STOCK_ITEM")
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(
          { ...key, ...s, entityType: type, schemaVersion: 1, data },
          { removeUndefinedValues: true },
        ),
        ConditionExpression:
          version === undefined
            ? "attribute_not_exists(PK)"
            : "orgId = :org AND outletId = :out AND entityType = :type AND #d.#v = :v",
        ...(version === undefined
          ? {}
          : {
              ExpressionAttributeNames: { "#d": "data", "#v": "version" },
              ExpressionAttributeValues: marshall({
                ":org": s.orgId,
                ":out": s.outletId,
                ":type": type,
                ":v": version,
              }),
            }),
      },
    };
  }
  static async commit(actions: TransactWriteItem[]) {
    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: actions }),
    );
  }
  static async list<T>(
    s: InventoryScope,
    pk: string,
    prefix: string,
    type: string,
    schema: z.ZodType<T>,
    input: { limit?: number; cursor?: string },
    newestFirst = false,
  ): Promise<{ items: T[]; nextCursor?: string }> {
    InventoryScopeSchema.parse(s);
    const base = K.restaurantStockPK(s.orgId, s.outletId);
    if (pk !== base && !pk.startsWith(base + "#"))
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(input.limit ?? 50);
    let start: InventoryKey | undefined;
    if (input.cursor) {
      try {
        z.string().max(2048).parse(input.cursor);
        const c = z
          .object({ PK: z.literal(pk), SK: z.string().startsWith(prefix) })
          .strict()
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
        start = c;
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const r = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": pk, ":prefix": prefix }),
        ConsistentRead: true,
        ScanIndexForward: !newestFirst,
        Limit: limit,
        ExclusiveStartKey: start && marshall(start),
      }),
    );
    const items = (r.Items ?? []).map((raw) => {
      const row = unmarshall(raw);
      if (typeof row.SK !== "string" || !row.SK.startsWith(prefix))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      return this.decode(s, { PK: pk, SK: row.SK }, type, schema, raw);
    });
    return {
      items,
      nextCursor: r.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(unmarshall(r.LastEvaluatedKey))).toString(
            "base64url",
          )
        : undefined,
    };
  }
}
