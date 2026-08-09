import { AccountingAccountReferenceService } from "@/lambda/domains/accounting/accounts/accounting-account-reference-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const accountingAccount = {
  PK: "ORG#org-a",
  SK: "ACC#52100000",
  orgId: "org-a",
  accountId: "52100000",
  accountName: "Bank",
  accountNature: "BALANCE",
  accountUsage: "BOTH",
  isThirdPartyAccount: false,
  classCode: 5,
  financialStatementCode: "BS",
  allowReconciliation: true,
  isActive: true,
  entityType: "ACCOUNT",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("AccountingAccountReferenceService", () => {
  beforeEach(() => dynamoMock.reset());

  test("validates a Treasury account reference with one direct Accounting-owned read", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall(accountingAccount),
    });

    await expect(
      AccountingAccountReferenceService.assertTreasuryAccountReference({
        orgId: "org-a",
        accountId: "52100000",
      }),
    ).resolves.toBeUndefined();

    const get = dynamoMock.commandCalls(GetItemCommand)[0].args[0].input;
    expect(get).toMatchObject({
      Key: {
        PK: { S: "ORG#org-a" },
        SK: { S: "ACC#52100000" },
      },
    });
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(1);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("rejects a non-class-5 reference before reading persistence", async () => {
    await expect(
      AccountingAccountReferenceService.assertTreasuryAccountReference({
        orgId: "org-a",
        accountId: "41100000",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNT_NOT_TREASURY_CLASS",
    });
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
  });

  test("preserves the missing-account error", async () => {
    dynamoMock.on(GetItemCommand).resolves({});

    await expect(
      AccountingAccountReferenceService.assertTreasuryAccountReference({
        orgId: "org-a",
        accountId: "52100000",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      messageCode: "ERROR_ACCOUNT_NOT_FOUND",
    });
  });

  test("does not accept an account returned from another organization", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        ...accountingAccount,
        PK: "ORG#org-b",
        orgId: "org-b",
      }),
    });

    await expect(
      AccountingAccountReferenceService.assertTreasuryAccountReference({
        orgId: "org-a",
        accountId: "52100000",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      messageCode: "ERROR_ACCOUNT_NOT_FOUND",
    });
  });

  test("preserves inactive-account rejection", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({ ...accountingAccount, isActive: false }),
    });

    await expect(
      AccountingAccountReferenceService.assertTreasuryAccountReference({
        orgId: "org-a",
        accountId: "52100000",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNT_NOT_ACTIVE",
    });
  });

  test("preserves class-5 validation after persistence parsing", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        ...accountingAccount,
        accountId: "42100000",
        classCode: 4,
      }),
    });

    await expect(
      AccountingAccountReferenceService.assertTreasuryAccountReference({
        orgId: "org-a",
        accountId: "52100000",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNT_NOT_TREASURY_CLASS",
    });
  });
});
