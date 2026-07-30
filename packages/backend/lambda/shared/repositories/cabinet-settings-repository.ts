import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  TransactionCanceledException,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ApplicationLanguageSchema,
  CabinetAddressSchema,
  CabinetContactSchema,
  OnboardingAccountingFrameworkSchema,
  WorkspaceCountrySchema,
} from "@liass-ohada/shared/shared";
import { z } from "zod";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export const CabinetSettingsItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.literal("SETTINGS#CABINET"),
    entityType: z.literal("CABINET_SETTINGS"),
    cabinetOrgId: z.string().min(1),
    contact: CabinetContactSchema.optional(),
    address: CabinetAddressSchema.optional(),
    preferredLanguage: ApplicationLanguageSchema.optional(),
    defaultClientCountry: WorkspaceCountrySchema.optional(),
    defaultAccountingFramework: OnboardingAccountingFrameworkSchema.optional(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    createdBy: z.string().min(1),
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1),
  })
  .strict();

export type CabinetSettingsItem = z.infer<typeof CabinetSettingsItemSchema>;

export interface CabinetOrganizationRecord {
  orgId: string;
  name: string;
  country?: string;
  accountingFramework?: string;
  workspaceType: string;
  status: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

export class CabinetSettingsConflictError extends Error {
  constructor() {
    super("Cabinet settings conditional write failed");
    this.name = "CabinetSettingsConflictError";
  }
}

export class CabinetSettingsDataError extends Error {
  constructor() {
    super("Cabinet settings item is inconsistent");
    this.name = "CabinetSettingsDataError";
  }
}

const settingsKey = (cabinetOrgId: string) => ({
  PK: { S: KeyFactory.orgKey(cabinetOrgId) },
  SK: { S: KeyFactory.cabinetSettingsSK() },
});

const settingsPut = (
  item: CabinetSettingsItem,
  conditionExpression: string,
  expressionAttributeValues?: Record<string, { N: string }>,
): TransactWriteItem => ({
  Put: {
    TableName: config.TABLE_NAME,
    Item: marshall(item, { removeUndefinedValues: true }),
    ConditionExpression: conditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
  },
});

const mapConditionalFailure = (error: unknown): never => {
  if (
    error instanceof TransactionCanceledException ||
    error instanceof ConditionalCheckFailedException
  ) {
    throw new CabinetSettingsConflictError();
  }
  throw error;
};

export class CabinetSettingsRepository {
  static buildInitialItem(input: {
    cabinetOrgId: string;
    country: z.infer<typeof WorkspaceCountrySchema>;
    accountingFramework?: z.infer<typeof OnboardingAccountingFrameworkSchema>;
    actorUserId: string;
    now: string;
  }): CabinetSettingsItem {
    return CabinetSettingsItemSchema.parse({
      PK: KeyFactory.orgKey(input.cabinetOrgId),
      SK: KeyFactory.cabinetSettingsSK(),
      entityType: "CABINET_SETTINGS",
      cabinetOrgId: input.cabinetOrgId,
      preferredLanguage: "fr",
      defaultClientCountry: input.country,
      defaultAccountingFramework: input.accountingFramework,
      version: 1,
      createdAt: input.now,
      createdBy: input.actorUserId,
      updatedAt: input.now,
      updatedBy: input.actorUserId,
    });
  }

  static async getCabinetSettings(
    cabinetOrgId: string,
  ): Promise<CabinetSettingsItem | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: settingsKey(cabinetOrgId),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const parsed = CabinetSettingsItemSchema.safeParse(unmarshall(result.Item));
    if (!parsed.success) throw new CabinetSettingsDataError();
    return parsed.data;
  }

  static async getOrganization(
    cabinetOrgId: string,
  ): Promise<CabinetOrganizationRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(cabinetOrgId) },
          SK: { S: KeyFactory.organizationSK() },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const value = unmarshall(result.Item);
    if (
      value.entityType !== "ORGANIZATION" ||
      value.orgId !== cabinetOrgId ||
      typeof value.name !== "string" ||
      typeof value.workspaceType !== "string" ||
      typeof value.status !== "string" ||
      typeof value.updatedAt !== "string"
    ) {
      return undefined;
    }
    return {
      orgId: cabinetOrgId,
      name: value.name,
      country: typeof value.country === "string" ? value.country : undefined,
      accountingFramework:
        typeof value.accountingFramework === "string"
          ? value.accountingFramework
          : undefined,
      workspaceType: value.workspaceType,
      status: value.status,
      updatedAt: value.updatedAt,
      raw: value,
    };
  }

  static async createCabinetSettings(item: CabinetSettingsItem): Promise<void> {
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(CabinetSettingsItemSchema.parse(item), {
            removeUndefinedValues: true,
          }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error) {
      mapConditionalFailure(error);
    }
  }

  static async updateCabinetSettings(
    item: CabinetSettingsItem,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(CabinetSettingsItemSchema.parse(item), {
            removeUndefinedValues: true,
          }),
          ConditionExpression: "#version = :expectedVersion",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: {
            ":expectedVersion": { N: String(expectedVersion) },
          },
        }),
      );
    } catch (error) {
      mapConditionalFailure(error);
    }
  }

  static async transactUpdate(input: {
    organization: CabinetOrganizationRecord;
    organizationChanges?: { name?: string; country?: string };
    settings: CabinetSettingsItem;
    expectedVersion: number;
  }): Promise<void> {
    const transactItems: TransactWriteItem[] = [];
    if (input.organizationChanges) {
      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(
            {
              ...input.organization.raw,
              ...input.organizationChanges,
              updatedAt: input.settings.updatedAt,
            },
            { removeUndefinedValues: true },
          ),
          ConditionExpression:
            "entityType = :organizationType AND updatedAt = :organizationUpdatedAt",
          ExpressionAttributeValues: {
            ":organizationType": { S: "ORGANIZATION" },
            ":organizationUpdatedAt": { S: input.organization.updatedAt },
          },
        },
      });
    }

    transactItems.push(
      input.expectedVersion === 0
        ? settingsPut(
            input.settings,
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          )
        : settingsPut(input.settings, "#version = :expectedVersion", {
            ":expectedVersion": { N: String(input.expectedVersion) },
          }),
    );
    const settingsWrite = transactItems.at(-1)?.Put;
    if (settingsWrite && input.expectedVersion > 0) {
      settingsWrite.ExpressionAttributeNames = { "#version": "version" };
    }

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error) {
      mapConditionalFailure(error);
    }
  }
}
