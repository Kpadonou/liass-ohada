import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

const fiscalYearItem = marshall({
  orgId: "test-org",
  year: 2026,
  fiscalYearId: "FY2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "OPEN",
  accountingFramework: "SYSCOHADA_REVISED",
  entityType: "FISCAL_YEAR",
  PK: "ORG#test-org",
  SK: "FY#2026",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const journalItem = marshall({
  orgId: "test-org",
  year: 2026,
  journalCode: "OD",
  journalName: "Operations diverses",
  type: "MISC",
  entityType: "JOURNAL",
  PK: "ORG#test-org",
  SK: "JNL#OD",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const accountItems = [
  marshall({
    orgId: "test-org",
    accountId: "41100000",
    accountName: "Clients",
    isActive: true,
    entityType: "ACCOUNT",
    PK: "ORG#test-org",
    SK: "ACC#41100000",
  }),
  marshall({
    orgId: "test-org",
    accountId: "70100000",
    accountName: "Ventes",
    isActive: true,
    entityType: "ACCOUNT",
    PK: "ORG#test-org",
    SK: "ACC#70100000",
  }),
];

const draftHeader = {
  orgId: "test-org",
  year: 2026,
  entryId: "E-draft",
  entryType: "STANDARD",
  entryDate: "2026-01-15",
  journalCode: "OD",
  label: "Draft sale",
  totalDebit: 1000,
  totalCredit: 1000,
  status: "DRAFT",
  lineIds: ["E-draft#L1", "E-draft#L2"],
  entityType: "ENTRY",
  PK: "ORG#test-org#FY#2026",
  SK: "E#E-draft",
  GSI5PK: "ORG#test-org#FY#2026",
  GSI5SK: "JNL#OD#DT#2026-01-15#E#E-draft",
  createdBy: "user-123",
  createdAt: "2026-01-15T00:00:00Z",
  updatedBy: "user-123",
  updatedAt: "2026-01-15T00:00:00Z",
};

const postedHeader = {
  ...draftHeader,
  status: "POSTED",
  postedBy: "user-123",
  postedAt: "2026-01-15T00:00:00Z",
};

const draftLines = [
  {
    orgId: "test-org",
    year: 2026,
    entryId: "E-draft",
    lineId: "E-draft#L1",
    entryDate: "2026-01-15",
    journalCode: "OD",
    accountId: "41100000",
    debit: 1000,
    credit: 0,
    label: "Customer",
    entityType: "ENTRY_LINE",
    PK: "ORG#test-org#FY#2026",
    SK: "L#E-draft#L1",
    createdBy: "user-123",
    createdAt: "2026-01-15T00:00:00Z",
    updatedBy: "user-123",
    updatedAt: "2026-01-15T00:00:00Z",
  },
  {
    orgId: "test-org",
    year: 2026,
    entryId: "E-draft",
    lineId: "E-draft#L2",
    entryDate: "2026-01-15",
    journalCode: "OD",
    accountId: "70100000",
    debit: 0,
    credit: 1000,
    label: "Revenue",
    entityType: "ENTRY_LINE",
    PK: "ORG#test-org#FY#2026",
    SK: "L#E-draft#L2",
    createdBy: "user-123",
    createdAt: "2026-01-15T00:00:00Z",
    updatedBy: "user-123",
    updatedAt: "2026-01-15T00:00:00Z",
  },
];

describe("LedgerService entry drafts", () => {
  beforeEach(() => {
    dynamoMock.reset();
  });

  test("creates a draft without ledger indexes or balance updates", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: fiscalYearItem });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({ Items: draftLines.map((line) => marshall(line)) });
    dynamoMock.on(BatchGetItemCommand).resolves({ Responses: { [tableName]: accountItems } });

    const draft = await LedgerService.createDraftEntry({
      orgId: "test-org",
      userId: "user-123",
      data: {
        year: 2026,
        entryDate: "2026-01-15",
        journalCode: "OD",
        entryType: "STANDARD",
        label: "Draft sale",
        lines: [
          { accountId: "41100000", debit: 1000, credit: 0 },
          { accountId: "70100000", debit: 0, credit: 1000 },
        ],
      },
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const linePut = unmarshall(transaction.TransactItems?.[1].Put?.Item ?? {});

    expect(draft.status).toBe("DRAFT");
    expect(linePut.GSI1PK).toBeUndefined();
    expect(linePut.GSI2PK).toBeUndefined();
    expect(transaction.TransactItems).toHaveLength(3);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("updates a draft and replaces draft lines", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshall(draftHeader) })
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: marshall({ ...draftHeader, label: "Updated draft" }) });
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: draftLines.map((line) => marshall(line)) })
      .resolvesOnce({ Items: draftLines.map((line) => marshall({ ...line, label: "Updated" })) });
    dynamoMock.on(BatchGetItemCommand).resolves({ Responses: { [tableName]: accountItems } });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await LedgerService.updateDraftEntry({
      orgId: "test-org",
      userId: "user-123",
      data: {
        entryId: "E-draft",
        year: 2026,
        entryDate: "2026-01-16",
        journalCode: "OD",
        entryType: "STANDARD",
        label: "Updated draft",
        lines: [
          { accountId: "41100000", debit: 2000, credit: 0 },
          { accountId: "70100000", debit: 0, credit: 2000 },
        ],
      },
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;

    expect(result.entryId).toBe("E-draft");
    expect(transaction.TransactItems?.[0].Update?.ConditionExpression).toBe("#status = :draft");
    expect(transaction.TransactItems?.filter((item) => item.Delete)).toHaveLength(2);
    expect(transaction.TransactItems?.filter((item) => item.Put)).toHaveLength(2);
  });

  test("does not update posted entries as drafts", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: marshall(postedHeader) });

    await expect(
      LedgerService.updateDraftEntry({
        orgId: "test-org",
        userId: "user-123",
        data: {
          entryId: "E-draft",
          year: 2026,
          entryDate: "2026-01-16",
          journalCode: "OD",
          entryType: "STANDARD",
          lines: [],
        },
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_ENTRY_DRAFT_NOT_EDITABLE" });

    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("deletes only draft entries and their draft lines", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: marshall(draftHeader) });
    dynamoMock.on(QueryCommand).resolvesOnce({ Items: draftLines.map((line) => marshall(line)) });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await expect(
      LedgerService.deleteDraftEntry("test-org", 2026, "E-draft"),
    ).resolves.toEqual({ entryId: "E-draft" });

    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems).toHaveLength(3);
    expect(transaction.TransactItems?.[0].Delete?.ConditionExpression).toBe("#status = :draft");
  });

  test("posts a draft with existing posting validations and balance updates", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshall(draftHeader) })
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: journalItem })
      .resolvesOnce({ Item: undefined });
    dynamoMock.on(QueryCommand).resolvesOnce({ Items: draftLines.map((line) => marshall(line)) });
    dynamoMock.on(BatchGetItemCommand).resolves({ Responses: { [tableName]: accountItems } });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await expect(
      LedgerService.postDraftEntry("test-org", "user-123", 2026, "E-draft"),
    ).resolves.toEqual({ entryId: "E-draft" });

    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems?.[0].Update?.UpdateExpression).toContain("#status = :posted");
    expect(transaction.TransactItems?.filter((item) => item.Put)).toHaveLength(2);
    expect(transaction.TransactItems?.filter((item) => item.Update)).toHaveLength(3);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("returns entry detail without persistence keys", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: marshall(postedHeader) });
    dynamoMock.on(QueryCommand).resolvesOnce({ Items: draftLines.map((line) => marshall(line)) });
    dynamoMock.on(BatchGetItemCommand).resolves({ Responses: { [tableName]: accountItems } });

    const detail = await LedgerService.getEntryDetail("test-org", 2026, "E-draft");

    expect(detail.lines[0].accountName).toBe("Clients");
    expect(detail).not.toHaveProperty("PK");
    expect(detail.lines[0]).not.toHaveProperty("SK");
    expect(detail.lines[0]).not.toHaveProperty("GSI1PK");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("lists entries with a status filter on GSI5 without scan", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [marshall(postedHeader)] });

    await LedgerService.listEntries("test-org", {
      year: "2026",
      status: "POSTED",
      limit: 20,
    });

    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(queryInput.IndexName).toBe("GSI5");
    expect(queryInput.FilterExpression).toBe("#status = :status");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
