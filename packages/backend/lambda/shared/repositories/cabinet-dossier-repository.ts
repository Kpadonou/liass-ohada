import {
  QueryCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  CabinetDossierSummary,
  CabinetDossierSummarySchema,
  Organization,
  OrganizationSchema,
  WorkspaceSummary,
} from "@liass-ohada/shared";
import { z } from "zod";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export const CabinetClientDossierItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("CABINET_DOSSIER"),
    cabinetId: z.string().min(1),
    orgId: z.string().min(1),
    displayName: z.string().min(1),
    country: z.string().min(1),
    accountingFramework: z.string().min(1),
    status: z.literal("ACTIVE"),
    relationship: z.literal("CLIENT"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    GSI1PK: z.string().min(1),
    GSI1SK: z.string().min(1),
  })
  .strict();

export const CabinetClientOrganizationItemSchema = OrganizationSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("ORGANIZATION"),
  ownerUserId: z.string().min(1),
});

export const CabinetClientUserOrgAccessItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("USER_ORG_ACCESS"),
    orgId: z.string().min(1),
    userId: z.string().min(1),
    role: z.literal("OWNER"),
    status: z.literal("ACTIVE"),
    accessSource: z.literal("CABINET"),
    cabinetId: z.string().min(1),
    displayName: z.string().min(1),
    workspaceType: z.literal("COMPANY"),
    country: z.string().min(1),
    accountingFramework: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    GSI6PK: z.string().min(1),
    GSI6SK: z.string().min(1),
  })
  .strict();

export type CabinetClientDossierItem = z.infer<
  typeof CabinetClientDossierItemSchema
>;
export type CabinetClientOrganizationItem = z.infer<
  typeof CabinetClientOrganizationItemSchema
>;
export type CabinetClientUserOrgAccessItem = z.infer<
  typeof CabinetClientUserOrgAccessItemSchema
>;

interface CreateClientDossierItemsInput {
  userId: string;
  cabinetId: string;
  organization: Organization;
  workspace: WorkspaceSummary;
}

const putIfAbsent = (
  item:
    | CabinetClientDossierItem
    | CabinetClientOrganizationItem
    | CabinetClientUserOrgAccessItem,
): TransactWriteItem => ({
  Put: {
    TableName: config.TABLE_NAME,
    Item: marshall(item, { removeUndefinedValues: true }),
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
  },
});

function dossierSummaryFromItem(item: Record<string, unknown>) {
  return CabinetDossierSummarySchema.safeParse({
    orgId: item.orgId,
    displayName: item.displayName,
    country: item.country,
    accountingFramework: item.accountingFramework,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

export class CabinetDossierRepository {
  static async listClientDossiers({
    cabinetId,
    cabinetOrgId,
  }: {
    cabinetId: string;
    cabinetOrgId: string;
  }): Promise<CabinetDossierSummary[]> {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI1,
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.cabinetDossierGSI_PK(cabinetId) },
          ":skPrefix": { S: "DOSSIER#" },
        },
      }),
    );

    return (response.Items || [])
      .map((item) => unmarshall(item))
      .filter(
        (item) =>
          item.entityType === "CABINET_DOSSIER" &&
          item.cabinetId === cabinetId &&
          item.orgId !== cabinetOrgId &&
          item.relationship !== "OWNED" &&
          item.status === "ACTIVE",
      )
      .map(dossierSummaryFromItem)
      .flatMap((result) => (result.success ? [result.data] : []))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  static async createClientDossierItems({
    userId,
    cabinetId,
    organization,
  }: CreateClientDossierItemsInput): Promise<void> {
    const organizationPk = KeyFactory.orgKey(organization.orgId);
    const organizationItem = CabinetClientOrganizationItemSchema.parse({
      ...organization,
      PK: organizationPk,
      SK: KeyFactory.organizationSK(),
      entityType: "ORGANIZATION",
      ownerUserId: userId,
    });
    const accessItem = CabinetClientUserOrgAccessItemSchema.parse({
      PK: organizationPk,
      SK: KeyFactory.orgUserAccessSK(userId),
      entityType: "USER_ORG_ACCESS",
      orgId: organization.orgId,
      userId,
      role: "OWNER",
      status: "ACTIVE",
      accessSource: "CABINET",
      cabinetId,
      displayName: organization.name,
      workspaceType: "COMPANY",
      country: organization.country,
      accountingFramework: organization.accountingFramework,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      GSI6PK: KeyFactory.userWorkspacesPK(userId),
      GSI6SK: KeyFactory.userWorkspaceSK("ACTIVE", organization.orgId),
    });
    const dossierItem = CabinetClientDossierItemSchema.parse({
      PK: KeyFactory.cabinetPK(cabinetId),
      SK: KeyFactory.cabinetDossierSK(organization.orgId),
      entityType: "CABINET_DOSSIER",
      cabinetId,
      orgId: organization.orgId,
      displayName: organization.name,
      country: organization.country,
      accountingFramework: organization.accountingFramework,
      status: "ACTIVE",
      relationship: "CLIENT",
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      GSI1PK: KeyFactory.cabinetDossierGSI_PK(cabinetId),
      GSI1SK: KeyFactory.cabinetDossierGSI_SK(organization.orgId),
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          putIfAbsent(organizationItem),
          putIfAbsent(accessItem),
          putIfAbsent(dossierItem),
        ],
      }),
    );
  }
}
