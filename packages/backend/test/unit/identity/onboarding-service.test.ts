import {
  DynamoDBClient,
  ScanCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { randomUUID } from "crypto";
import { OnboardingService } from "@/lambda/shared/services/onboarding-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("crypto", () => ({
  randomUUID: jest.fn(),
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    getUserWorkspaces: jest.fn(),
  },
}));

const dynamoMock = mockClient(DynamoDBClient);
const ORG_UUID = "00000000-0000-4000-8000-000000000001";
const CABINET_UUID = "00000000-0000-4000-8000-000000000002";
const GENERATED_ORG_ID = `org-${ORG_UUID}`;
const GENERATED_CABINET_ID = `cab-${CABINET_UUID}`;

const unmarshalledTransactItems = () => {
  const input = dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;

  return (input.TransactItems || []).map((item) => {
    if (!item.Put?.Item) {
      throw new Error("Expected Put transaction item");
    }

    return {
      condition: item.Put.ConditionExpression,
      item: unmarshall(item.Put.Item),
    };
  });
};

describe("OnboardingService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest.mocked(TenantAccessService.getUserWorkspaces).mockResolvedValue([]);
  });

  test("creates a company organization and user access in one transaction", async () => {
    jest
      .mocked(randomUUID)
      .mockReturnValueOnce(ORG_UUID);
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await OnboardingService.createInitialWorkspace("user-123", {
      workspaceType: "COMPANY",
      organizationName: "Demo SARL",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });
    const transactionItems = unmarshalledTransactItems();

    expect(response).toEqual({
      organization: {
        orgId: GENERATED_ORG_ID,
        displayName: "Demo SARL",
        workspaceType: "COMPANY",
        status: "ACTIVE",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
      workspace: {
        orgId: GENERATED_ORG_ID,
        role: "OWNER",
        accessSource: "DIRECT",
        displayName: "Demo SARL",
        workspaceType: "COMPANY",
        status: "ACTIVE",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
      activeOrgId: GENERATED_ORG_ID,
    });
    expect(transactionItems).toHaveLength(3);
    expect(transactionItems.map(({ condition }) => condition)).toEqual([
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    ]);
    expect(transactionItems.map(({ item }) => item.entityType)).toEqual([
      "ORGANIZATION",
      "USER_ORG_ACCESS",
      "INITIAL_WORKSPACE_LOCK",
    ]);
    expect(transactionItems[0].item).toMatchObject({
      PK: `ORG#${GENERATED_ORG_ID}`,
      SK: "ORG#METADATA",
      orgId: GENERATED_ORG_ID,
      ownerUserId: "user-123",
    });
    expect(transactionItems[1].item).toMatchObject({
      PK: `ORG#${GENERATED_ORG_ID}`,
      SK: "USER#user-123",
      userId: "user-123",
      role: "OWNER",
      GSI6PK: "USER#user-123",
      GSI6SK: `STATUS#ACTIVE#ORG#${GENERATED_ORG_ID}`,
    });
    expect(transactionItems[2].item).toMatchObject({
      PK: "USER#user-123",
      SK: "ONBOARDING#INITIAL_WORKSPACE",
      userId: "user-123",
      orgId: GENERATED_ORG_ID,
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("creates accounting firm cabinet metadata and dossier link", async () => {
    jest
      .mocked(randomUUID)
      .mockReturnValueOnce(ORG_UUID)
      .mockReturnValueOnce(CABINET_UUID);
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await OnboardingService.createInitialWorkspace("user-123", {
      workspaceType: "ACCOUNTING_FIRM",
      organizationName: "Cabinet Demo",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });
    const transactionItems = unmarshalledTransactItems();

    expect(response.activeOrgId).toBe(GENERATED_ORG_ID);
    expect(response.organization.cabinetId).toBe(GENERATED_CABINET_ID);
    expect(response.workspace.cabinetId).toBe(GENERATED_CABINET_ID);
    expect(transactionItems).toHaveLength(5);
    expect(transactionItems[3].item).toMatchObject({
      PK: `CABINET#${GENERATED_CABINET_ID}`,
      SK: "CABINET#METADATA",
      entityType: "CABINET",
      cabinetId: GENERATED_CABINET_ID,
      ownerUserId: "user-123",
    });
    expect(transactionItems[4].item).toMatchObject({
      PK: `CABINET#${GENERATED_CABINET_ID}`,
      SK: `DOSSIER#${GENERATED_ORG_ID}`,
      entityType: "CABINET_DOSSIER",
      cabinetId: GENERATED_CABINET_ID,
      orgId: GENERATED_ORG_ID,
      GSI1PK: `CABINET#${GENERATED_CABINET_ID}`,
      GSI1SK: `DOSSIER#${GENERATED_ORG_ID}`,
    });
  });

  test("rejects duplicate onboarding when active workspaces already exist", async () => {
    jest.mocked(TenantAccessService.getUserWorkspaces).mockResolvedValue([
      { orgId: "org-existing" },
    ]);

    await expect(
      OnboardingService.createInitialWorkspace("user-123", {
        workspaceType: "COMPANY",
        organizationName: "Demo SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "WORKSPACE_ALREADY_EXISTS",
    });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("maps transaction cancellation to duplicate onboarding", async () => {
    jest
      .mocked(randomUUID)
      .mockReturnValueOnce(ORG_UUID);
    dynamoMock.on(TransactWriteItemsCommand).rejects(
      new TransactionCanceledException({
        $metadata: {},
        message: "Transaction cancelled",
      }),
    );

    await expect(
      OnboardingService.createInitialWorkspace("user-123", {
        workspaceType: "COMPANY",
        organizationName: "Demo SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "WORKSPACE_ALREADY_EXISTS",
    });
  });
});
