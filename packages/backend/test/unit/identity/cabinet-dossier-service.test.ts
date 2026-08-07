import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { randomUUID } from "crypto";
import { CabinetDossierService } from "@/lambda/shared/services/cabinet-dossier-service";

jest.mock("crypto", () => ({
  randomUUID: jest.fn(),
}));

const dynamoMock = mockClient(DynamoDBClient);
const ORG_UUID = "00000000-0000-4000-8000-000000000003";
const GENERATED_ORG_ID = `org-${ORG_UUID}`;

const accountingFirmContext = {
  orgId: "org-cabinet",
  userId: "user-123",
  cabinetId: "cab-123",
  workspaceType: "ACCOUNTING_FIRM" as const,
};

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

describe("CabinetDossierService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("lists client dossiers through cabinet dossier GSI and excludes the cabinet self-link", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        entityType: "USER_ORG_ACCESS",
        orgId: "org-cabinet",
        userId: "user-123",
        cabinetId: "cab-123",
        cabinetRole: "CABINET_ADMIN",
        workspaceType: "ACCOUNTING_FIRM",
        status: "ACTIVE",
        updatedAt: "2026-06-03T00:00:00.000Z",
      }),
    });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          entityType: "CABINET_DOSSIER",
          cabinetId: "cab-123",
          orgId: "org-cabinet",
          displayName: "Cabinet Demo",
          status: "ACTIVE",
          relationship: "OWNED",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        }),
        marshall({
          entityType: "CABINET_DOSSIER",
          cabinetId: "cab-123",
          orgId: "org-client",
          displayName: "Client SARL",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          status: "ACTIVE",
          relationship: "CLIENT",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        }),
      ],
    });

    const response = await CabinetDossierService.listClientDossiers(
      accountingFirmContext,
    );

    expect(response.dossiers).toEqual([
      {
        orgId: "org-client",
        displayName: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        status: "ACTIVE",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        accessMode: "READ_WRITE",
      },
    ]);
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": { S: "CABINET#cab-123" },
        ":skPrefix": { S: "DOSSIER#" },
      },
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("rejects company workspaces for cabinet dossier operations", async () => {
    await expect(
      CabinetDossierService.listClientDossiers({
        orgId: "org-company",
        userId: "user-123",
        workspaceType: "COMPANY",
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      messageCode: "ERROR_CABINET_WORKSPACE_REQUIRED",
    });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("lists only exact assigned dossiers for a Reader with read-only access", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        entityType: "USER_ORG_ACCESS",
        orgId: "org-cabinet",
        userId: "user-123",
        cabinetId: "cab-123",
        cabinetRole: "READER",
        workspaceType: "ACCOUNTING_FIRM",
        status: "ACTIVE",
        updatedAt: "2026-06-03T00:00:00.000Z",
      }),
    });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          PK: "CABINET#org-cabinet",
          SK: "ASSIGNMENT#USER#user-123#DOSSIER#org-client",
          entityType: "CABINET_DOSSIER_ASSIGNMENT",
          cabinetOrgId: "org-cabinet",
          userId: "user-123",
          dossierOrgId: "org-client",
          assignedBy: "admin-1",
          assignedAt: "2026-06-03T00:00:00.000Z",
        }),
      ],
    });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        "liass-ohada-test-accounting-table": [
          marshall({
            PK: "CABINET#cab-123",
            SK: "DOSSIER#org-client",
            entityType: "CABINET_DOSSIER",
            cabinetId: "cab-123",
            orgId: "org-client",
            relationship: "CLIENT",
            status: "ACTIVE",
          }),
          marshall({
            PK: "ORG#org-client",
            SK: "ORG#METADATA",
            entityType: "ORGANIZATION",
            orgId: "org-client",
            name: "Client SARL",
            country: "BJ",
            accountingFramework: "SYSCOHADA_REVISED",
            workspaceType: "COMPANY",
            status: "ACTIVE",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
          }),
        ],
      },
    });

    await expect(
      CabinetDossierService.listClientDossiers(accountingFirmContext),
    ).resolves.toEqual({
      dossiers: [
        expect.objectContaining({
          accessMode: "READ_ONLY",
          displayName: "Client SARL",
          orgId: "org-client",
        }),
      ],
    });
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    });
    expect(
      dynamoMock.commandCalls(QueryCommand)[0].args[0].input.IndexName,
    ).toBeUndefined();
    expect(
      dynamoMock.commandCalls(BatchGetItemCommand)[0].args[0].input.RequestItems?.[
        "liass-ohada-test-accounting-table"
      ],
    ).toMatchObject({ ConsistentRead: true });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("creates client organization, cabinet link, and materialized access in one transaction", async () => {
    jest.mocked(randomUUID).mockReturnValueOnce(ORG_UUID);
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await CabinetDossierService.createClientDossier(
      accountingFirmContext,
      {
        companyName: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
    );
    const transactionItems = unmarshalledTransactItems();

    expect(response.activeDossierOrgId).toBe(GENERATED_ORG_ID);
    expect(response.dossier.displayName).toBe("Client SARL");
    expect(transactionItems).toHaveLength(4);
    expect(transactionItems.map(({ condition }) => condition)).toEqual([
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    ]);
    expect(transactionItems.map(({ item }) => item.entityType)).toEqual([
      "ORGANIZATION",
      "USER_ORG_ACCESS",
      "CABINET_DOSSIER",
      "ACCOUNTING_SETTINGS",
    ]);
    expect(transactionItems[1].item).toMatchObject({
      PK: `ORG#${GENERATED_ORG_ID}`,
      SK: "USER#user-123",
      accessSource: "CABINET",
      cabinetId: "cab-123",
      workspaceType: "COMPANY",
      GSI6PK: "USER#user-123",
      GSI6SK: `STATUS#ACTIVE#ORG#${GENERATED_ORG_ID}`,
    });
    expect(transactionItems[2].item).toMatchObject({
      PK: "CABINET#cab-123",
      SK: `DOSSIER#${GENERATED_ORG_ID}`,
      relationship: "CLIENT",
      GSI1PK: "CABINET#cab-123",
      GSI1SK: `DOSSIER#${GENERATED_ORG_ID}`,
    });
    expect(transactionItems[3].item).toMatchObject({
      PK: `ORG#${GENERATED_ORG_ID}`,
      SK: "SETTINGS#ACCOUNTING",
      entityType: "ACCOUNTING_SETTINGS",
      accountingFramework: "SYSCOHADA_REVISED",
    });
  });

  test("maps transaction cancellation to duplicate dossier conflict", async () => {
    jest.mocked(randomUUID).mockReturnValueOnce(ORG_UUID);
    dynamoMock.on(TransactWriteItemsCommand).rejects(
      new TransactionCanceledException({
        $metadata: {},
        message: "Transaction cancelled",
      }),
    );

    await expect(
      CabinetDossierService.createClientDossier(accountingFirmContext, {
        companyName: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "CABINET_DOSSIER_ALREADY_EXISTS",
    });
  });

  test("maps non-cancellation transaction failures to dossier creation failure", async () => {
    jest.mocked(randomUUID).mockReturnValueOnce(ORG_UUID);
    dynamoMock.on(TransactWriteItemsCommand).rejects(new Error("DynamoDB failed"));

    await expect(
      CabinetDossierService.createClientDossier(accountingFirmContext, {
        companyName: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      messageCode: "CABINET_DOSSIER_CREATE_FAILED",
    });
  });
});
