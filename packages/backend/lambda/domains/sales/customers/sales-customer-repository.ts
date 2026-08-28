import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesCustomer,
  SalesCustomerSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";

export const SalesCustomerItemSchema = SalesCustomerSchema.extend({
  PK: z.string().min(1),
  SK: z.string().startsWith("SALES_CUSTOMER#"),
  entityType: z.literal("SALES_CUSTOMER"),
  orgId: z.string().min(1),
}).strict();

export type SalesCustomerItem = z.infer<typeof SalesCustomerItemSchema>;

export class SalesCustomerWriteConflictError extends Error {
  constructor() {
    super("Sales customer conditional write failed");
    this.name = "SalesCustomerWriteConflictError";
  }
}

const isConditionalFailure = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException ||
  (error as { name?: string } | undefined)?.name ===
    "ConditionalCheckFailedException";

const toCustomer = (item: SalesCustomerItem): SalesCustomer =>
  SalesCustomerSchema.parse({
    id: item.id,
    customerType: item.customerType,
    name: item.name,
    email: item.email,
    phone: item.phone,
    taxIdentifier: item.taxIdentifier,
    billingAddress: item.billingAddress,
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
      !logicalKey.SK.startsWith(KeyFactory.salesCustomerPrefix())
    ) {
      throw new Error("Cursor is outside the customer collection");
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

export class SalesCustomerRepository {
  static buildItem(orgId: string, customer: SalesCustomer): SalesCustomerItem {
    return SalesCustomerItemSchema.parse({
      ...customer,
      orgId,
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.salesCustomerSK(customer.id),
      entityType: "SALES_CUSTOMER",
    });
  }

  static async create(orgId: string, customer: SalesCustomer): Promise<void> {
    const item = this.buildItem(orgId, customer);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SalesCustomerWriteConflictError();
      }
      throw error;
    }
  }

  static async get(
    orgId: string,
    customerId: string,
  ): Promise<SalesCustomer | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.salesCustomerSK(customerId) },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;

    const item = SalesCustomerItemSchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId || item.id !== customerId) return undefined;
    return toCustomer(item);
  }

  static async list(
    orgId: string,
    input: { limit?: number; cursor?: string },
  ): Promise<{ items: SalesCustomer[]; nextCursor?: string }> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":prefix": KeyFactory.salesCustomerPrefix(),
        }),
        Limit: input.limit ?? 50,
        ExclusiveStartKey: decodeCursor(input.cursor, orgId),
        ScanIndexForward: true,
      }),
    );

    return {
      items: (result.Items ?? [])
        .map((rawItem) =>
          SalesCustomerItemSchema.parse(unmarshall(rawItem)),
        )
        .filter(
          (item) =>
            item.orgId === orgId &&
            item.PK === KeyFactory.orgKey(orgId) &&
            item.SK === KeyFactory.salesCustomerSK(item.id),
        )
        .map(toCustomer),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async update(
    orgId: string,
    customer: SalesCustomer,
    expectedVersion: number,
  ): Promise<void> {
    const item = this.buildItem(orgId, customer);
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          ConditionExpression:
            "#entityType = :entityType AND #version = :expectedVersion",
          ExpressionAttributeNames: {
            "#entityType": "entityType",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":entityType": { S: "SALES_CUSTOMER" },
            ":expectedVersion": { N: String(expectedVersion) },
          },
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new SalesCustomerWriteConflictError();
      }
      throw error;
    }
  }
}
