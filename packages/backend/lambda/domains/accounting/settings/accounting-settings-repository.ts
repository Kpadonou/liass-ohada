import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccountingSettings,
  AccountingSettingsSchema,
} from "@liass-ohada/shared/accounting";
import { z } from "zod";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";

export const AccountingSettingsItemSchema = AccountingSettingsSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("ACCOUNTING_SETTINGS"),
}).strict();

export type AccountingSettingsItem = z.infer<
  typeof AccountingSettingsItemSchema
>;

export interface LegacyOrganizationAccountingConfiguration {
  accountingFramework?: unknown;
  organizationExists: boolean;
}

const toAccountingSettings = (
  item: AccountingSettingsItem,
): AccountingSettings =>
  AccountingSettingsSchema.parse({
    orgId: item.orgId,
    accountingFramework: item.accountingFramework,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });

const conditionalPut = (item: AccountingSettingsItem): TransactWriteItem => ({
  Put: {
    TableName: config.TABLE_NAME,
    Item: marshall(AccountingSettingsItemSchema.parse(item)),
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
  },
});

export class AccountingSettingsRepository {
  static buildItem(input: AccountingSettings): AccountingSettingsItem {
    return AccountingSettingsItemSchema.parse({
      ...input,
      PK: KeyFactory.orgKey(input.orgId),
      SK: KeyFactory.accountingSettingsSK(),
      entityType: "ACCOUNTING_SETTINGS",
    });
  }

  static buildPutIfAbsentTransaction(
    input: AccountingSettings,
  ): TransactWriteItem {
    return conditionalPut(this.buildItem(input));
  }

  static async getAccountingSettings(
    orgId: string,
  ): Promise<AccountingSettings | null> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.accountingSettingsSK() },
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return null;
    }

    return toAccountingSettings(
      AccountingSettingsItemSchema.parse(unmarshall(response.Item)),
    );
  }

  static async getLegacyOrganizationConfiguration(
    orgId: string,
  ): Promise<LegacyOrganizationAccountingConfiguration> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.organizationSK() },
        },
        ConsistentRead: true,
      }),
    );

    if (!response.Item) {
      return { organizationExists: false };
    }

    const item = unmarshall(response.Item);
    if (item.entityType !== "ORGANIZATION" || item.orgId !== orgId) {
      return { organizationExists: false };
    }

    return {
      accountingFramework: item.accountingFramework,
      organizationExists: true,
    };
  }

  static async putIfAbsent(item: AccountingSettingsItem): Promise<boolean> {
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(AccountingSettingsItemSchema.parse(item)),
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
