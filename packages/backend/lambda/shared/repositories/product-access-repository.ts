import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ProductAccess,
  ProductAccessSchema,
  ProductAccessStatus,
  ProductAccessStatusSchema,
  ProductCode,
  ProductCodeSchema,
} from "@liass-ohada/shared/shared";
import { z } from "zod";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export const LEGACY_PRODUCT_CODES = ["PROJECTS", "TREASURY"] as const;
export const LegacyProductCodeSchema = z.enum(LEGACY_PRODUCT_CODES);
export const PersistedProductCodeSchema = z.enum([
  "ACCOUNTING",
  "SALES",
  ...LEGACY_PRODUCT_CODES,
]);

export const ProductAccessItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("PRODUCT_ACCESS"),
    orgId: z.string().min(1),
    productCode: PersistedProductCodeSchema,
    status: ProductAccessStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type ProductAccessItem = z.infer<typeof ProductAccessItemSchema>;
export type CanonicalProductAccessItem = ProductAccessItem & {
  productCode: ProductCode;
};
export type PersistedProductCode = z.infer<typeof PersistedProductCodeSchema>;
export type LegacyProductCode = z.infer<typeof LegacyProductCodeSchema>;
export type PersistedProductAccess = Omit<ProductAccessItem, "PK" | "SK" | "entityType">;

export type ProductAccessMigrationInspection =
  | {
      expectedProductCode: PersistedProductCode;
      state: "ABSENT";
    }
  | {
      access: PersistedProductAccess;
      expectedProductCode: PersistedProductCode;
      state: "VALID";
    }
  | {
      actualEntityType?: string;
      actualOrgId?: string;
      actualProductCode?: string;
      expectedProductCode: PersistedProductCode;
      state: "MISMATCH";
    };

const toProductAccess = (item: ProductAccessItem): ProductAccess =>
  ProductAccessSchema.parse({
    orgId: item.orgId,
    productCode: item.productCode,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });

const toPersistedProductAccess = (
  item: ProductAccessItem,
): PersistedProductAccess => ({
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
  }): CanonicalProductAccessItem {
    const productCode = ProductCodeSchema.parse(input.productCode);
    return ProductAccessItemSchema.parse({
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.productAccessSK(productCode),
      entityType: "PRODUCT_ACCESS",
      orgId: input.orgId,
      productCode,
      status: input.status,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    }) as CanonicalProductAccessItem;
  }

  static buildPutIfAbsentTransaction(
    item: ProductAccessItem,
  ): TransactWriteItem {
    return {
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(ProductAccessItemSchema.parse(item)),
        ConditionExpression:
          "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    };
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

  /** Migration-only direct read that tolerates legacy ProductAccess codes. */
  static async inspectProductAccessForMigration(
    orgId: string,
    productCode: PersistedProductCode,
  ): Promise<ProductAccessMigrationInspection> {
    const expectedProductCode = PersistedProductCodeSchema.parse(productCode);
    const expectedPK = KeyFactory.orgKey(orgId);
    const expectedSK = KeyFactory.productAccessSK(expectedProductCode);
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: expectedPK },
          SK: { S: expectedSK },
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return { expectedProductCode, state: "ABSENT" };
    }

    const raw = unmarshall(response.Item) as Record<string, unknown>;
    const parsed = ProductAccessItemSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.PK !== expectedPK ||
      parsed.data.SK !== expectedSK ||
      parsed.data.orgId !== orgId ||
      parsed.data.productCode !== expectedProductCode
    ) {
      return {
        actualEntityType:
          typeof raw.entityType === "string" ? raw.entityType : undefined,
        actualOrgId: typeof raw.orgId === "string" ? raw.orgId : undefined,
        actualProductCode:
          typeof raw.productCode === "string" ? raw.productCode : undefined,
        expectedProductCode,
        state: "MISMATCH",
      };
    }

    return {
      access: toPersistedProductAccess(parsed.data),
      expectedProductCode,
      state: "VALID",
    };
  }

  /** Migration-only conditional delete; canonical ACCOUNTING is rejected. */
  static async deleteLegacyProductAccessForMigration(
    orgId: string,
    productCode: LegacyProductCode,
  ): Promise<void> {
    const legacyProductCode = LegacyProductCodeSchema.parse(productCode);
    const PK = KeyFactory.orgKey(orgId);
    const SK = KeyFactory.productAccessSK(legacyProductCode);
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: PK },
          SK: { S: SK },
        },
        ConditionExpression:
          "PK = :pk AND SK = :sk AND entityType = :entityType AND orgId = :orgId AND productCode = :productCode",
        ExpressionAttributeValues: {
          ":pk": { S: PK },
          ":sk": { S: SK },
          ":entityType": { S: "PRODUCT_ACCESS" },
          ":orgId": { S: orgId },
          ":productCode": { S: legacyProductCode },
        },
      }),
    );
  }

  static async listProductAccess(
    orgId: string,
  ): Promise<PersistedProductAccess[]> {
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
      toPersistedProductAccess(
        ProductAccessItemSchema.parse(unmarshall(item)),
      ),
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
