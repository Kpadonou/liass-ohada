import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  CabinetSettingsConflictError,
  CabinetSettingsRepository,
} from "@/lambda/shared/repositories/cabinet-settings-repository";

const dynamoMock = mockClient(DynamoDBClient);
const now = "2026-07-30T10:00:00.000Z";
const item = CabinetSettingsRepository.buildInitialItem({
  cabinetOrgId: "org-cabinet",
  country: "BJ",
  accountingFramework: "SYSCOHADA_REVISED",
  actorUserId: "admin-1",
  now,
});

describe("CabinetSettingsRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("uses exact KeyFactory keys and a strongly consistent read", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(item) });
    await expect(
      CabinetSettingsRepository.getCabinetSettings("org-cabinet"),
    ).resolves.toEqual(item);
    const input = dynamoMock.commandCalls(GetItemCommand)[0].args[0].input;
    expect(input.Key).toEqual({
      PK: { S: "ORG#org-cabinet" },
      SK: { S: "SETTINGS#CABINET" },
    });
    expect(input.ConsistentRead).toBe(true);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("returns undefined for a missing settings item", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    await expect(
      CabinetSettingsRepository.getCabinetSettings("org-cabinet"),
    ).resolves.toBeUndefined();
  });

  test("creates conditionally without canonical Organization duplicates", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await CabinetSettingsRepository.createCabinetSettings(item);
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    const stored = unmarshall(input.Item ?? {});
    expect(stored.organizationName).toBeUndefined();
    expect(stored.country).toBeUndefined();
    expect(stored.defaultClientCountry).toBe("BJ");
  });

  test("maps duplicate creation and stale updates to a repository conflict", async () => {
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: "stale" }),
    );
    await expect(
      CabinetSettingsRepository.createCabinetSettings(item),
    ).rejects.toBeInstanceOf(CabinetSettingsConflictError);
    await expect(
      CabinetSettingsRepository.updateCabinetSettings(
        { ...item, version: 2 },
        1,
      ),
    ).rejects.toBeInstanceOf(CabinetSettingsConflictError);
  });

  test("transacts canonical Organization and versioned settings atomically", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
    await CabinetSettingsRepository.transactUpdate({
      organization: {
        orgId: "org-cabinet",
        name: "Old name",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        workspaceType: "ACCOUNTING_FIRM",
        status: "ACTIVE",
        updatedAt: now,
        raw: {
          PK: "ORG#org-cabinet",
          SK: "ORG#METADATA",
          entityType: "ORGANIZATION",
          orgId: "org-cabinet",
          name: "Old name",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          workspaceType: "ACCOUNTING_FIRM",
          status: "ACTIVE",
          ownerUserId: "owner-1",
          createdAt: now,
          updatedAt: now,
        },
      },
      organizationChanges: { name: "New name", country: "SN" },
      settings: { ...item, version: 2, updatedAt: now },
      expectedVersion: 1,
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems).toHaveLength(2);
    const organization = unmarshall(
      transaction.TransactItems?.[0].Put?.Item ?? {},
    );
    expect(organization).toMatchObject({
      name: "New name",
      country: "SN",
      ownerUserId: "owner-1",
    });
    expect(transaction.TransactItems?.[1].Put?.ConditionExpression).toBe(
      "#version = :expectedVersion",
    );
  });

  test("uses conditional creation for a legacy version-zero transaction", async () => {
    dynamoMock.on(TransactWriteItemsCommand).rejects(
      new TransactionCanceledException({ $metadata: {}, message: "raced" }),
    );
    await expect(
      CabinetSettingsRepository.transactUpdate({
        organization: {
          orgId: "org-cabinet",
          name: "Cabinet",
          country: "BJ",
          workspaceType: "ACCOUNTING_FIRM",
          status: "ACTIVE",
          updatedAt: now,
          raw: {},
        },
        settings: item,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(CabinetSettingsConflictError);
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems?.[0].Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
  });
});
