import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { AccountingSettingsRepository } from "@/lambda/domains/accounting/settings/accounting-settings-repository";

const dynamoMock = mockClient(DynamoDBClient);
const persistenceItem = {
  PK: "ORG#org-123",
  SK: "SETTINGS#ACCOUNTING",
  entityType: "ACCOUNTING_SETTINGS",
  orgId: "org-123",
  accountingFramework: "SYCEBNL",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

describe("AccountingSettingsRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("gets settings directly from the organization partition without leaking keys", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(persistenceItem) });

    const result =
      await AccountingSettingsRepository.getAccountingSettings("org-123");
    const input = dynamoMock.commandCalls(GetItemCommand)[0].args[0].input;

    expect(input.Key).toEqual({
      PK: { S: "ORG#org-123" },
      SK: { S: "SETTINGS#ACCOUNTING" },
    });
    expect(input.ConsistentRead).toBe(true);
    expect(result).toEqual({
      orgId: "org-123",
      accountingFramework: "SYCEBNL",
      createdAt: persistenceItem.createdAt,
      updatedAt: persistenceItem.updatedAt,
    });
    expect(result).not.toHaveProperty("PK");
    expect(result).not.toHaveProperty("SK");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("validates the backend persistence shape", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({ ...persistenceItem, accountingFramework: "IFRS" }),
    });

    await expect(
      AccountingSettingsRepository.getAccountingSettings("org-123"),
    ).rejects.toThrow();
  });

  test("uses a conditional put and preserves an existing settings row", async () => {
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: "already exists",
      }),
    );
    const item = AccountingSettingsRepository.buildItem({
      orgId: "org-123",
      accountingFramework: "SYSCOHADA_REVISED",
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T10:00:00.000Z",
    });

    await expect(AccountingSettingsRepository.putIfAbsent(item)).resolves.toBe(
      false,
    );
    expect(
      dynamoMock.commandCalls(PutItemCommand)[0].args[0].input
        .ConditionExpression,
    ).toBe("attribute_not_exists(PK) AND attribute_not_exists(SK)");
  });
});
