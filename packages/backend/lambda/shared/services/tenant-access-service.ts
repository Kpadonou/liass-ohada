import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { WorkspaceSummary } from "@liass-ohada/shared";
import type { CabinetRole } from "@liass-ohada/shared";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { OnboardingRepository } from "../repositories/onboarding-repository";

export interface TenantAccess {
  role?: string;
  cabinetRole?: CabinetRole;
  cabinetId?: string;
  accessSource?: string;
  displayName?: string;
  workspaceType?: "COMPANY" | "ACCOUNTING_FIRM";
  country?: string;
  accountingFramework?: string;
}

interface AssertUserCanAccessOrgInput {
  orgId: string;
  userId: string;
}

export class TenantAccessService {
  static async assertUserCanAccessOrg({
    orgId,
    userId,
  }: AssertUserCanAccessOrgInput): Promise<TenantAccess> {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.orgUserAccessSK(userId) },
        },
      }),
    );

    if (!response.Item) {
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    }

    const access = unmarshall(response.Item);

    if (
      access.entityType !== "USER_ORG_ACCESS" ||
      access.orgId !== orgId ||
      access.userId !== userId ||
      access.status !== "ACTIVE"
    ) {
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    }

    return {
      role: typeof access.role === "string" ? access.role : undefined,
      cabinetRole:
        access.cabinetRole === "CABINET_ADMIN" ||
        access.cabinetRole === "SUPERVISOR" ||
        access.cabinetRole === "COLLABORATOR" ||
        access.cabinetRole === "READER"
          ? access.cabinetRole
          : undefined,
      cabinetId: typeof access.cabinetId === "string" ? access.cabinetId : undefined,
      accessSource:
        typeof access.accessSource === "string" ? access.accessSource : undefined,
      displayName:
        typeof access.displayName === "string" ? access.displayName : undefined,
      workspaceType:
        access.workspaceType === "COMPANY" ||
        access.workspaceType === "ACCOUNTING_FIRM"
          ? access.workspaceType
          : undefined,
      country: typeof access.country === "string" ? access.country : undefined,
      accountingFramework:
        typeof access.accountingFramework === "string"
          ? access.accountingFramework
          : undefined,
    };
  }

  static async getUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return OnboardingRepository.listActiveUserWorkspaces(userId);
  }
}
