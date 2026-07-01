import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

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
  journalCode: "SALES",
  journalName: "Sales",
  type: "SALE",
  entityType: "JOURNAL",
  PK: "ORG#test-org",
  SK: "JNL#SALES",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const accountItems = [
  marshall({
    orgId: "test-org",
    accountId: "41100000",
    accountName: "Clients",
    isActive: true,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE",
    entityType: "ACCOUNT",
    PK: "ORG#test-org",
    SK: "ACC#41100000",
  }),
  marshall({
    orgId: "test-org",
    accountId: "70100000",
    accountName: "Ventes",
    isActive: true,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE",
    entityType: "ACCOUNT",
    PK: "ORG#test-org",
    SK: "ACC#70100000",
  }),
];

const openingAccountItems = [
  accountItems[0],
  marshall({
    orgId: "test-org",
    accountId: "51200000",
    accountName: "Banque",
    isActive: true,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE",
    entityType: "ACCOUNT",
    PK: "ORG#test-org",
    SK: "ACC#51200000",
  }),
];

const validEntry = {
  year: 2026,
  entryDate: "2026-03-15",
  journalCode: "SALES",
  entryType: "STANDARD" as const,
  label: "Customer invoice",
  lines: [
    { accountId: "41100000", debit: 1000, credit: 0 },
    { accountId: "70100000", debit: 0, credit: 1000 },
  ],
};

describe("LedgerService accounting integrity", () => {
  beforeEach(() => {
    dynamoMock.reset();
  });

  test("validates fiscal year, journal, period, entities and writes atomically", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: journalItem })
      .resolvesOnce({ Item: undefined });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        "liass-ohada-test-accounting-table": accountItems,
      },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await LedgerService.postEntry({
      orgId: "test-org",
      userId: "user-123",
      data: validEntry,
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const header = unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {});

    expect(result.entryId).toMatch(/^E-/);
    expect(header.journalCode).toBe("SALES");
    expect(header.GSI5PK).toBe("ORG#test-org#FY#2026");
    expect(header.GSI5SK).toContain("JNL#SALES#DT#2026-03-15#E#");
    expect(header.updatedBy).toBe("user-123");
  });

  test("rejects entries outside fiscal year boundaries", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: fiscalYearItem });

    await expect(
      LedgerService.postEntry({
        orgId: "test-org",
        userId: "user-123",
        data: {
          ...validEntry,
          entryDate: "2027-01-01",
        },
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_ENTRY_DATE_OUTSIDE_FISCAL_YEAR" });

    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("rejects normal entries when the journal does not exist", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: undefined });

    await expect(
      LedgerService.postEntry({
        orgId: "test-org",
        userId: "user-123",
        data: validEntry,
      }),
    ).rejects.toMatchObject({ messageCode: "JOURNAL_NOT_FOUND" });

    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("rejects posting into a locked period", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: journalItem })
      .resolvesOnce({
        Item: marshall({
          PK: "ORG#test-org#FY#2026",
          SK: "LOCK#PERIOD#03",
          orgId: "test-org",
          year: 2026,
          month: "03",
          status: "LOCKED",
          entityType: "PERIOD_LOCK",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      });

    await expect(
      LedgerService.postEntry({
        orgId: "test-org",
        userId: "user-123",
        data: validEntry,
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_PERIOD_LOCKED" });

    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("rejects posting into a closed fiscal year", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: marshall({
        ...unmarshall(fiscalYearItem),
        status: "CLOSED",
      }),
    });

    await expect(
      LedgerService.postEntry({
        orgId: "test-org",
        userId: "user-123",
        data: validEntry,
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_FISCAL_YEAR_LOCKED" });

    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("keeps existing posted entries readable after close", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({
        Item: marshall({
          orgId: "test-org",
          year: 2026,
          entryId: "E-1",
          entryType: "STANDARD",
          entryDate: "2026-03-15",
          journalCode: "SALES",
          totalDebit: 1000,
          totalCredit: 1000,
          status: "POSTED",
          entityType: "ENTRY",
          PK: "ORG#test-org#FY#2026",
          SK: "E#E-1",
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        }),
      });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          orgId: "test-org",
          year: 2026,
          entryId: "E-1",
          lineId: "E-1#L1",
          accountId: "41100000",
          debit: 1000,
          credit: 0,
          entryDate: "2026-03-15",
          journalCode: "SALES",
          entityType: "ENTRY_LINE",
          PK: "ORG#test-org#FY#2026",
          SK: "L#E-1#L1",
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        }),
        marshall({
          orgId: "test-org",
          year: 2026,
          entryId: "E-1",
          lineId: "E-1#L2",
          accountId: "70100000",
          debit: 0,
          credit: 1000,
          entryDate: "2026-03-15",
          journalCode: "SALES",
          entityType: "ENTRY_LINE",
          PK: "ORG#test-org#FY#2026",
          SK: "L#E-1#L2",
          createdAt: "2026-03-15T00:00:00Z",
          updatedAt: "2026-03-15T00:00:00Z",
        }),
      ],
    });
    dynamoMock.on(BatchGetItemCommand).resolves({ Responses: {} });

    const detail = await LedgerService.getEntryDetail("test-org", 2026, "E-1");

    expect(detail).toMatchObject({
      entryId: "E-1",
      status: "POSTED",
      totalDebit: 1000,
      totalCredit: 1000,
    });
    expect(detail.lines).toHaveLength(2);
  });

  test("allows RAN opening entries for balance-sheet accounts without a configured journal", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: undefined });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        "liass-ohada-test-accounting-table": openingAccountItems,
      },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await expect(
      LedgerService.postEntry({
        orgId: "test-org",
        userId: "user-123",
        data: {
          ...validEntry,
          entryDate: "2026-01-01",
          journalCode: "RAN",
          entryType: "OPENING",
          lines: [
            { accountId: "41100000", debit: 1000, credit: 0 },
            { accountId: "51200000", debit: 0, credit: 1000 },
          ],
        },
      }),
    ).resolves.toMatchObject({ entryId: expect.stringMatching(/^E-/) });
  });

  test("rejects RAN opening entries using management accounts", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: fiscalYearItem });

    await expect(
      LedgerService.postEntry({
        orgId: "test-org",
        userId: "user-123",
        data: {
          ...validEntry,
          entryDate: "2026-01-01",
          journalCode: "RAN",
          entryType: "OPENING",
        },
      }),
    ).rejects.toMatchObject({
      messageCode: "ERROR_OPENING_ENTRY_INVALID_ACCOUNT_CLASS",
    });

    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });
});
