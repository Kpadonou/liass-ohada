import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesCatalogItem,
  SalesCatalogItemSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";

export const SalesCatalogItemPersistenceSchema = SalesCatalogItemSchema.extend({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_ITEM#"),
  entityType: z.literal("SALES_ITEM"),
  orgId: z.string().min(1),
}).strict();

export type SalesCatalogItemPersistence = z.infer<
  typeof SalesCatalogItemPersistenceSchema
>;

export class SalesCatalogItemWriteConflictError extends Error {
  constructor() {
    super("Sales catalog item conditional write failed");
    this.name = "SalesCatalogItemWriteConflictError";
  }
}

const isConditionalFailure = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException ||
  (error as { name?: string } | undefined)?.name ===
    "ConditionalCheckFailedException";

const toCatalogItem = (
  item: SalesCatalogItemPersistence,
): SalesCatalogItem =>
  SalesCatalogItemSchema.parse({
    id: item.id,
    itemType: item.itemType,
    name: item.name,
    description: item.description,
    unit: item.unit,
    isActive: item.isActive,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });

const decodeCursor = (
  cursor: string | undefined,
  orgId: string,
): Record<string, AttributeValue> | undefined => {
  if (!cursor) return undefined;

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("Invalid cursor payload");
    }
    const logicalKey = unmarshall(decoded);
    if (
      logicalKey.PK !== KeyFactory.orgKey(orgId) ||
      typeof logicalKey.SK !== "string" ||
      !logicalKey.SK.startsWith(KeyFactory.salesItemPrefix())
    ) {
      throw new Error("Cursor is outside the catalog item collection");
    }
    return decoded;
  } catch {
    throw new AppError(400, "ERROR_INVALID_CURSOR");
  }
};

const encodeCursor = (
  key: Record<string, unknown> | undefined,
): string | undefined =>
  key ? Buffer.from(JSON.stringify(key)).toString("base64") : undefined;

export class SalesCatalogItemRepository {
  static buildItem(
    orgId: string,
    item: SalesCatalogItem,
  ): SalesCatalogItemPersistence {
    return SalesCatalogItemPersistenceSchema.parse({
      ...item,
      orgId,
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.salesItemSK(item.id),
      entityType: "SALES_ITEM",
    });
  }

  static async create(orgId: string, item: SalesCatalogItem): Promise<void> {
    const persistenceItem = this.buildItem(orgId, item);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(persistenceItem, { removeUndefinedValues: true }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SalesCatalogItemWriteConflictError();
      }
      throw error;
    }
  }

  static async get(
    orgId: string,
    itemId: string,
  ): Promise<SalesCatalogItem | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.salesItemSK(itemId) },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;

    const item = SalesCatalogItemPersistenceSchema.parse(
      unmarshall(result.Item),
    );
    if (item.orgId !== orgId || item.id !== itemId) return undefined;
    return toCatalogItem(item);
  }

  static async list(
    orgId: string,
    input: { limit?: number; cursor?: string },
  ): Promise<{ items: SalesCatalogItem[]; nextCursor?: string }> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":prefix": KeyFactory.salesItemPrefix(),
        }),
        Limit: input.limit ?? 50,
        ExclusiveStartKey: decodeCursor(input.cursor, orgId),
        ScanIndexForward: true,
      }),
    );

    return {
      items: (result.Items ?? [])
        .map((rawItem) =>
          SalesCatalogItemPersistenceSchema.parse(unmarshall(rawItem)),
        )
        .filter(
          (item) =>
            item.orgId === orgId &&
            item.PK === KeyFactory.orgKey(orgId) &&
            item.SK === KeyFactory.salesItemSK(item.id),
        )
        .map(toCatalogItem),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async update(
    orgId: string,
    item: SalesCatalogItem,
    expectedVersion: number,
  ): Promise<void> {
    const persistenceItem = this.buildItem(orgId, item);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(persistenceItem, { removeUndefinedValues: true }),
          ConditionExpression:
            "#entityType = :entityType AND #version = :expectedVersion",
          ExpressionAttributeNames: {
            "#entityType": "entityType",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":entityType": { S: "SALES_ITEM" },
            ":expectedVersion": { N: String(expectedVersion) },
          },
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SalesCatalogItemWriteConflictError();
      }
      throw error;
    }
  }
}
