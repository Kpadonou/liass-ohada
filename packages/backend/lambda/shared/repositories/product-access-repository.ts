import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  PRODUCT_CODES,
  ProductAccess,
  ProductAccessSchema,
  ProductAccessStatus,
  ProductCode,
} from "@liass-ohada/shared/shared";
import { z } from "zod";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export const ProductAccessItemSchema = ProductAccessSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("PRODUCT_ACCESS"),
}).strict();

export type ProductAccessItem = z.infer<typeof ProductAccessItemSchema>;

const toProductAccess = (item: ProductAccessItem): ProductAccess =>
  ProductAccessSchema.parse({
    orgId: item.orgId,
    productCode: item.productCode,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });

export class ProductAccessRepository {
  static buildItem(input: {
    orgId: string;
    productCode: ProductCode;
    status: ProductAccessStatus;
    timestamp: string;
  }): ProductAccessItem {
    return ProductAccessItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.productAccessSK(input.productCode),
      entityType: "PRODUCT_ACCESS",
      orgId: input.orgId,
      productCode: input.productCode,
      status: input.status,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
  }

  static buildCompatibilityBaseline(
    orgId: string,
    timestamp: string,
  ): ProductAccessItem[] {
    return PRODUCT_CODES.map((productCode) =>
      this.buildItem({
        orgId,
        productCode,
        status: "ACTIVE",
        timestamp,
      }),
    );
  }

  static async getProductAccess(
    orgId: string,
    productCode: ProductCode,
  ): Promise<ProductAccess | null> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.productAccessSK(productCode) },
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    return toProductAccess(
      ProductAccessItemSchema.parse(unmarshall(response.Item)),
    );
  }

  static async listProductAccess(orgId: string): Promise<ProductAccess[]> {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":skPrefix": { S: KeyFactory.productAccessPrefix() },
        },
        ConsistentRead: true,
      }),
    );

    return (response.Items ?? []).map((item) =>
      toProductAccess(ProductAccessItemSchema.parse(unmarshall(item))),
    );
  }

  static async putIfAbsent(item: ProductAccessItem): Promise<boolean> {
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(ProductAccessItemSchema.parse(item)),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof ConditionalCheckFailedException ||
        (error as { name?: string })?.name === "ConditionalCheckFailedException"
      ) {
        return false;
      }
      throw error;
    }
  }
}
