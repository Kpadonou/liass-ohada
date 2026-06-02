import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export interface TenantAccess {
  role?: string;
  cabinetId?: string;
  accessSource?: string;
}

interface AssertUserCanAccessOrgInput {
  orgId: string;
  userId: string;
}

export interface WorkspaceSummary {
  orgId: string;
  role?: string;
  cabinetId?: string;
  accessSource?: string;
  displayName?: string;
  workspaceType?: string;
  status?: string;
  country?: string;
  accountingFramework?: string;
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
      cabinetId: typeof access.cabinetId === "string" ? access.cabinetId : undefined,
      accessSource:
        typeof access.accessSource === "string" ? access.accessSource : undefined,
    };
  }

  static async getUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
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

    return (response.Items || [])
      .map((item) => unmarshall(item))
      .filter(
        (access) =>
          access.entityType === "USER_ORG_ACCESS" &&
          access.userId === userId &&
          access.status === "ACTIVE" &&
          typeof access.orgId === "string",
      )
      .map((access) => ({
        orgId: access.orgId,
        role: typeof access.role === "string" ? access.role : undefined,
        cabinetId: typeof access.cabinetId === "string" ? access.cabinetId : undefined,
        accessSource:
          typeof access.accessSource === "string" ? access.accessSource : undefined,
        displayName:
          typeof access.displayName === "string" ? access.displayName : undefined,
        workspaceType:
          typeof access.workspaceType === "string" ? access.workspaceType : undefined,
        status: typeof access.status === "string" ? access.status : undefined,
        country: typeof access.country === "string" ? access.country : undefined,
        accountingFramework:
          typeof access.accountingFramework === "string"
            ? access.accountingFramework
            : undefined,
      }))
      .sort((left, right) => left.orgId.localeCompare(right.orgId));
  }
}
