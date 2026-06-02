import {
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  CreateInitialWorkspaceRequest,
  CreateInitialWorkspaceResponse,
  CreateInitialWorkspaceResponseSchema,
} from "@liass-ohada/shared";
import { randomUUID } from "crypto";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { TenantAccessService } from "./tenant-access-service";

const ACCESS_STATUS = "ACTIVE";
const OWNER_ROLE = "OWNER";

export class OnboardingService {
  static async createInitialWorkspace(
    userId: string,
    data: CreateInitialWorkspaceRequest,
  ): Promise<CreateInitialWorkspaceResponse> {
    const existingWorkspaces = await TenantAccessService.getUserWorkspaces(userId);

    if (existingWorkspaces.length > 0) {
      throw new AppError(409, "WORKSPACE_ALREADY_EXISTS");
    }

    const now = new Date().toISOString();
    const orgId = `org-${randomUUID()}`;
    const cabinetId =
      data.workspaceType === "ACCOUNTING_FIRM" ? `cab-${randomUUID()}` : undefined;
    const organizationName = data.organizationName.trim();
    const organizationPk = KeyFactory.orgKey(orgId);
    const accessItem = {
      PK: organizationPk,
      SK: KeyFactory.orgUserAccessSK(userId),
      entityType: "USER_ORG_ACCESS",
      orgId,
      userId,
      role: OWNER_ROLE,
      status: ACCESS_STATUS,
      accessSource: "DIRECT",
      cabinetId,
      displayName: organizationName,
      workspaceType: data.workspaceType,
      country: data.country,
      accountingFramework: data.accountingFramework,
      createdAt: now,
      updatedAt: now,
      GSI6PK: KeyFactory.userWorkspacesPK(userId),
      GSI6SK: KeyFactory.userWorkspaceSK(ACCESS_STATUS, orgId),
    };
    const organizationItem = {
      PK: organizationPk,
      SK: KeyFactory.organizationSK(),
      entityType: "ORGANIZATION",
      orgId,
      displayName: organizationName,
      workspaceType: data.workspaceType,
      status: ACCESS_STATUS,
      country: data.country,
      accountingFramework: data.accountingFramework,
      cabinetId,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    };
    const onboardingLockItem = {
      PK: KeyFactory.userWorkspacesPK(userId),
      SK: KeyFactory.initialWorkspaceLockSK(),
      entityType: "INITIAL_WORKSPACE_LOCK",
      userId,
      orgId,
      status: ACCESS_STATUS,
      createdAt: now,
    };
    const transactItems = [
      {
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(organizationItem, { removeUndefinedValues: true }),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
      {
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(accessItem, { removeUndefinedValues: true }),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
      {
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(onboardingLockItem, { removeUndefinedValues: true }),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
    ];

    if (cabinetId) {
      const cabinetPk = KeyFactory.cabinetPK(cabinetId);
      const cabinetMetadataItem = {
        PK: cabinetPk,
        SK: KeyFactory.cabinetMetadataSK(),
        entityType: "CABINET",
        cabinetId,
        orgId,
        displayName: organizationName,
        ownerUserId: userId,
        status: ACCESS_STATUS,
        country: data.country,
        accountingFramework: data.accountingFramework,
        createdAt: now,
        updatedAt: now,
      };
      const cabinetDossierItem = {
        PK: cabinetPk,
        SK: KeyFactory.cabinetDossierSK(orgId),
        entityType: "CABINET_DOSSIER",
        cabinetId,
        orgId,
        displayName: organizationName,
        status: ACCESS_STATUS,
        relationship: "OWNED",
        createdAt: now,
        updatedAt: now,
        GSI1PK: KeyFactory.cabinetDossierGSI_PK(cabinetId),
        GSI1SK: KeyFactory.cabinetDossierGSI_SK(orgId),
      };

      transactItems.push(
        {
          Put: {
            TableName: config.TABLE_NAME,
            Item: marshall(cabinetMetadataItem, { removeUndefinedValues: true }),
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          },
        },
        {
          Put: {
            TableName: config.TABLE_NAME,
            Item: marshall(cabinetDossierItem, { removeUndefinedValues: true }),
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          },
        },
      );
    }

    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(409, "WORKSPACE_ALREADY_EXISTS");
      }

      throw new AppError(500, "ONBOARDING_CREATE_FAILED");
    }

    return CreateInitialWorkspaceResponseSchema.parse({
      organization: {
        orgId,
        displayName: organizationName,
        workspaceType: data.workspaceType,
        status: ACCESS_STATUS,
        country: data.country,
        accountingFramework: data.accountingFramework,
        cabinetId,
      },
      workspace: {
        orgId,
        role: OWNER_ROLE,
        cabinetId,
        accessSource: "DIRECT",
        displayName: organizationName,
        workspaceType: data.workspaceType,
        status: ACCESS_STATUS,
        country: data.country,
        accountingFramework: data.accountingFramework,
      },
      activeOrgId: orgId,
    });
  }
}
