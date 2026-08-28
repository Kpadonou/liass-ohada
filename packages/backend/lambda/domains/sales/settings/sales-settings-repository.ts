import { GetItemCommand, TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  SalesSettings,
  SalesSettingsSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";

export const SalesSettingsItemSchema = SalesSettingsSchema.extend({
  PK: z.string().min(1),
  SK: z.literal("SETTINGS#SALES"),
  entityType: z.literal("SALES_SETTINGS"),
}).strict();

export type SalesSettingsItem = z.infer<typeof SalesSettingsItemSchema>;

const toSalesSettings = (item: SalesSettingsItem): SalesSettings =>
  SalesSettingsSchema.parse({
    orgId: item.orgId,
    defaultCurrency: item.defaultCurrency,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });

export class SalesSettingsRepository {
  static buildItem(input: SalesSettings): SalesSettingsItem {
    return SalesSettingsItemSchema.parse({
      ...input,
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.salesSettingsSK(),
      entityType: "SALES_SETTINGS",
    });
  }

  static buildPutIfAbsentTransaction(
    input: SalesSettings,
  ): TransactWriteItem {
    const item = this.buildItem(input);
    return {
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(item),
        ConditionExpression:
          "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    };
  }

  static async getSalesSettings(orgId: string): Promise<SalesSettings | null> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.salesSettingsSK() },
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    return toSalesSettings(
      SalesSettingsItemSchema.parse(unmarshall(response.Item)),
    );
  }
}
