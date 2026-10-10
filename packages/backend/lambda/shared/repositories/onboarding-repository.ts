import { ProductRolesSchema } from "@liass-ohada/shared/shared";
import {
  BatchGetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  Cabinet,
  CabinetSchema,
  Organization,
  OrganizationSchema,
  WorkspaceSummary,
  WorkspaceSummarySchema,
} from "@liass-ohada/shared";
import { z } from "zod";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { resolveCabinetRole } from "../cabinet-role";
import {
  CabinetSettingsItem,
  CabinetSettingsRepository,
} from "./cabinet-settings-repository";

const AccessSourceSchema = z.literal("DIRECT");
const OwnerRoleSchema = z.literal("OWNER");

export const OrganizationItemSchema = OrganizationSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("ORGANIZATION"),
  ownerUserId: z.string().min(1),
});

export const CabinetItemSchema = CabinetSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("CABINET"),
  accountingFramework: z.string().min(1),
});

export const UserOrgAccessItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("USER_ORG_ACCESS"),
    orgId: z.string().min(1),
    userId: z.string().min(1),
    role: OwnerRoleSchema,
    productRoles: ProductRolesSchema.optional(),
    cabinetRole: z.literal("CABINET_ADMIN").optional(),
    status: z.literal("ACTIVE"),
    accessSource: AccessSourceSchema,
    cabinetId: z.string().min(1).optional(),
    displayName: z.string().min(1),
    workspaceType: z.enum(["COMPANY", "ACCOUNTING_FIRM"]),
    country: z.string().min(1),
    accountingFramework: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    GSI6PK: z.string().min(1),
    GSI6SK: z.string().min(1),
  })
  .strict();

export const CabinetDossierItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("CABINET_DOSSIER"),
    cabinetId: z.string().min(1),
    orgId: z.string().min(1),
    displayName: z.string().min(1),
    status: z.literal("ACTIVE"),
    relationship: z.literal("OWNED"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    GSI1PK: z.string().min(1),
    GSI1SK: z.string().min(1),
  })
  .strict();

export const InitialWorkspaceLockItemSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    entityType: z.literal("INITIAL_WORKSPACE_LOCK"),
    userId: z.string().min(1),
    orgId: z.string().min(1),
    status: z.literal("ACTIVE"),
    createdAt: z.string().datetime(),
  })
  .strict();

export type OrganizationItem = z.infer<typeof OrganizationItemSchema>;
export type CabinetItem = z.infer<typeof CabinetItemSchema>;
export type UserOrgAccessItem = z.infer<typeof UserOrgAccessItemSchema>;
export type CabinetDossierItem = z.infer<typeof CabinetDossierItemSchema>;
export type InitialWorkspaceLockItem = z.infer<
  typeof InitialWorkspaceLockItemSchema
>;

interface CreateInitialWorkspaceItemsInput {
  accountingSettingsWrite: TransactWriteItem;
  productAccessWrites: TransactWriteItem[];
  userId: string;
  organization: Organization;
  cabinet: Cabinet | null;
  workspace: WorkspaceSummary;
}

const putIfAbsent = (
  item:
    | OrganizationItem
    | UserOrgAccessItem
    | InitialWorkspaceLockItem
    | CabinetItem
    | CabinetDossierItem
    | CabinetSettingsItem,
): TransactWriteItem => ({
  Put: {
    TableName: config.TABLE_NAME,
    Item: marshall(item, { removeUndefinedValues: true }),
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
  },
});

export class OnboardingRepository {
  static async listActiveUserWorkspaces(
    userId: string,
  ): Promise<WorkspaceSummary[]> {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI6,
        KeyConditionExpression: "GSI6PK = :pk AND begins_with(GSI6SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.userWorkspacesPK(userId) },
          ":skPrefix": { S: KeyFactory.activeUserWorkspacePrefix() },
        },
      }),
    );

    const accessRows = (response.Items || [])
      .map((item) => unmarshall(item))
      .filter(
        (access) =>
          access.entityType === "USER_ORG_ACCESS" &&
          access.userId === userId &&
          access.status === "ACTIVE" &&
          typeof access.orgId === "string",
      );
    const organizationResponses = await Promise.all(
      Array.from(
        { length: Math.ceil(accessRows.length / 100) },
        (_, index) => accessRows.slice(index * 100, (index + 1) * 100),
      ).map((chunk) =>
        dynamoClient.send(
          new BatchGetItemCommand({
            RequestItems: {
              [config.TABLE_NAME]: {
                Keys: chunk.map((access) => ({
                  PK: { S: KeyFactory.orgKey(String(access.orgId)) },
                  SK: { S: KeyFactory.organizationSK() },
                })),
                ConsistentRead: true,
              },
            },
          }),
        ),
      ),
    );
    const organizations = new Map(
      organizationResponses
        .flatMap((result) => result?.Responses?.[config.TABLE_NAME] ?? [])
        .map((item) => unmarshall(item))
        .filter(
          (item) =>
            item.entityType === "ORGANIZATION" && typeof item.orgId === "string",
        )
        .map((item) => [String(item.orgId), item]),
    );

    return accessRows
      .map((access) => {
        const organization = organizations.get(String(access.orgId));
        return WorkspaceSummarySchema.safeParse({
          orgId: access.orgId,
          role: typeof access.role === "string" ? access.role : undefined,
          cabinetRole: resolveCabinetRole(access),
          cabinetId:
            typeof access.cabinetId === "string" ? access.cabinetId : undefined,
          accessSource:
            typeof access.accessSource === "string"
              ? access.accessSource
              : undefined,
          displayName:
            typeof organization?.name === "string"
              ? organization.name
              : typeof access.displayName === "string"
                ? access.displayName
                : undefined,
          workspaceType:
            typeof organization?.workspaceType === "string"
              ? organization.workspaceType
              : typeof access.workspaceType === "string"
                ? access.workspaceType
                : undefined,
          status:
            typeof organization?.status === "string"
              ? organization.status
              : typeof access.status === "string"
                ? access.status
                : undefined,
          country:
            typeof organization?.country === "string"
              ? organization.country
              : typeof access.country === "string"
                ? access.country
                : undefined,
          accountingFramework:
            typeof organization?.accountingFramework === "string"
              ? organization.accountingFramework
              : typeof access.accountingFramework === "string"
                ? access.accountingFramework
                : undefined,
        });
      })
      .filter((result): result is { success: true; data: WorkspaceSummary } =>
        Boolean(result.success),
      )
      .map((result) => result.data)
      .sort((left, right) => left.orgId.localeCompare(right.orgId));
  }

  static async createInitialWorkspaceItems({
    accountingSettingsWrite,
    productAccessWrites,
    userId,
    organization,
    cabinet,
    workspace,
  }: CreateInitialWorkspaceItemsInput): Promise<void> {
    const organizationPk = KeyFactory.orgKey(organization.orgId);
    const organizationItem = OrganizationItemSchema.parse({
      ...organization,
      PK: organizationPk,
      SK: KeyFactory.organizationSK(),
      entityType: "ORGANIZATION",
      ownerUserId: userId,
    });
    const accessItem = UserOrgAccessItemSchema.parse({
      PK: organizationPk,
      SK: KeyFactory.orgUserAccessSK(userId),
      entityType: "USER_ORG_ACCESS",
      orgId: organization.orgId,
      userId,
      role: "OWNER",
      cabinetRole: workspace.cabinetRole,
      status: "ACTIVE",
      accessSource: "DIRECT",
      cabinetId: workspace.cabinetId,
      displayName: organization.name,
      workspaceType: organization.workspaceType,
      country: organization.country,
      accountingFramework: organization.accountingFramework,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      GSI6PK: KeyFactory.userWorkspacesPK(userId),
      GSI6SK: KeyFactory.userWorkspaceSK("ACTIVE", organization.orgId),
    });
    const onboardingLockItem = InitialWorkspaceLockItemSchema.parse({
      PK: KeyFactory.userWorkspacesPK(userId),
      SK: KeyFactory.initialWorkspaceLockSK(),
      entityType: "INITIAL_WORKSPACE_LOCK",
      userId,
      orgId: organization.orgId,
      status: "ACTIVE",
      createdAt: organization.createdAt,
    });
    const transactItems = [
      putIfAbsent(organizationItem),
      putIfAbsent(accessItem),
      putIfAbsent(onboardingLockItem),
    ];

    if (cabinet) {
      const settingsItem = CabinetSettingsRepository.buildInitialItem({
        cabinetOrgId: organization.orgId,
        country: organization.country,
        accountingFramework: organization.accountingFramework,
        actorUserId: userId,
        now: organization.createdAt,
      });
      const cabinetPk = KeyFactory.cabinetPK(cabinet.cabinetId);
      const cabinetItem = CabinetItemSchema.parse({
        ...cabinet,
        PK: cabinetPk,
        SK: KeyFactory.cabinetMetadataSK(),
        entityType: "CABINET",
        accountingFramework: organization.accountingFramework,
      });
      const cabinetDossierItem = CabinetDossierItemSchema.parse({
        PK: cabinetPk,
        SK: KeyFactory.cabinetDossierSK(organization.orgId),
        entityType: "CABINET_DOSSIER",
        cabinetId: cabinet.cabinetId,
        orgId: organization.orgId,
        displayName: organization.name,
        status: "ACTIVE",
        relationship: "OWNED",
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        GSI1PK: KeyFactory.cabinetDossierGSI_PK(cabinet.cabinetId),
        GSI1SK: KeyFactory.cabinetDossierGSI_SK(organization.orgId),
      });

      transactItems.push(
        putIfAbsent(cabinetItem),
        putIfAbsent(cabinetDossierItem),
        putIfAbsent(settingsItem),
      );
    }

    transactItems.push(...productAccessWrites);
    transactItems.push(accountingSettingsWrite);

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );
  }
}
