import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

const dynamoMock = mockClient(DynamoDBClient);

describe("TenantAccessService", () => {
  beforeEach(() => {
    dynamoMock.reset();
  });

  test("queries active user workspaces through GSI6", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          PK: "ORG#org-b",
          SK: "USER#user-123",
          entityType: "USER_ORG_ACCESS",
          orgId: "org-b",
          userId: "user-123",
          role: "MANAGER",
          status: "ACTIVE",
          accessSource: "CABINET",
          displayName: "Beta Organization",
          workspaceType: "COMPANY",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          GSI6PK: "USER#user-123",
          GSI6SK: "STATUS#ACTIVE#ORG#org-b",
        }),
        marshall({
          PK: "ORG#org-a",
          SK: "USER#user-123",
          entityType: "USER_ORG_ACCESS",
          orgId: "org-a",
          userId: "user-123",
          role: "ACCOUNTANT",
          status: "ACTIVE",
          cabinetId: "cab-001",
          accessSource: "DIRECT",
          GSI6PK: "USER#user-123",
          GSI6SK: "STATUS#ACTIVE#ORG#org-a",
        }),
      ],
    });

    const workspaces = await TenantAccessService.getUserWorkspaces("user-123");
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(queryInput.IndexName).toBe("GSI6");
    expect(queryInput.KeyConditionExpression).toBe(
      "GSI6PK = :pk AND begins_with(GSI6SK, :skPrefix)",
    );
    expect(queryInput.ExpressionAttributeValues).toEqual({
      ":pk": { S: "USER#user-123" },
      ":skPrefix": { S: "STATUS#ACTIVE#" },
    });
    expect(workspaces).toEqual([
      {
        orgId: "org-a",
        role: "ACCOUNTANT",
        cabinetId: "cab-001",
        accessSource: "DIRECT",
        displayName: undefined,
        workspaceType: undefined,
        status: "ACTIVE",
        country: undefined,
        accountingFramework: undefined,
      },
      {
        orgId: "org-b",
        role: "MANAGER",
        cabinetId: undefined,
        accessSource: "CABINET",
        displayName: "Beta Organization",
        workspaceType: "COMPANY",
        status: "ACTIVE",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
    ]);
  });

  test("filters malformed or inactive access rows defensively", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          entityType: "USER_ORG_ACCESS",
          orgId: "org-active",
          userId: "user-123",
          status: "ACTIVE",
        }),
        marshall({
          entityType: "USER_ORG_ACCESS",
          orgId: "org-inactive",
          userId: "user-123",
          status: "INACTIVE",
        }),
        marshall({
          entityType: "USER_ORG_ACCESS",
          orgId: "org-other-user",
          userId: "user-456",
          status: "ACTIVE",
        }),
      ],
    });

    await expect(TenantAccessService.getUserWorkspaces("user-123")).resolves.toEqual([
      {
        orgId: "org-active",
        role: undefined,
        cabinetId: undefined,
        accessSource: undefined,
        displayName: undefined,
        workspaceType: undefined,
        status: "ACTIVE",
        country: undefined,
        accountingFramework: undefined,
      },
    ]);
  });
});
