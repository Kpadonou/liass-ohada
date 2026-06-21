import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

const fiscalYear = marshall({
  orgId: "org-a",
  year: 2026,
  fiscalYearId: "FY2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "OPEN",
  accountingFramework: "SYSCOHADA_REVISED",
  entityType: "FISCAL_YEAR",
  PK: "ORG#org-a",
  SK: "FY#2026",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const journal = marshall({
  orgId: "org-a",
  year: 2026,
  journalCode: "SALES",
  journalName: "Sales",
  type: "SALE",
  entityType: "JOURNAL",
  PK: "ORG#org-a",
  SK: "JNL#SALES",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const accounts = [
  marshall({
    orgId: "org-a",
    accountId: "41100000",
    accountName: "Clients",
    isActive: true,
    isThirdPartyAccount: true,
    requiresThirdParty: true,
    auxiliaryType: "CUSTOMER",
    entityType: "ACCOUNT",
    PK: "ORG#org-a",
    SK: "ACC#41100000",
  }),
  marshall({
    orgId: "org-a",
    accountId: "70100000",
    accountName: "Ventes",
    isActive: true,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE",
    entityType: "ACCOUNT",
    PK: "ORG#org-a",
    SK: "ACC#70100000",
  }),
];

const customer = marshall({
  orgId: "org-a",
  thirdPartyId: "TP-1",
  code: "CLI001",
  displayName: "Client A",
  type: "CUSTOMER",
  status: "ACTIVE",
  entityType: "THIRD_PARTY",
  PK: "ORG#org-a",
  SK: "TP#CUSTOMER#TP-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const data = {
  year: 2026,
  entryId: "E-fixed",
  entryDate: "2026-03-15",
  journalCode: "SALES",
  entryType: "STANDARD" as const,
  label: "Customer invoice",
  lines: [
    {
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER" as const,
      debit: 1000,
      credit: 0,
    },
    { accountId: "70100000", debit: 0, credit: 1000 },
  ],
};

function mockPostingReads(existingHeader?: Record<string, unknown>) {
  dynamoMock
    .on(GetItemCommand)
    .resolvesOnce({ Item: fiscalYear })
    .resolvesOnce({ Item: journal })
    .resolvesOnce({ Item: undefined })
    .resolvesOnce({ Item: customer })
    .resolvesOnce({
      Item: existingHeader ? marshall(existingHeader) : undefined,
    });
  dynamoMock.on(BatchGetItemCommand).resolves({
    Responses: { [tableName]: accounts },
  });
}

describe("Lot 5.1 auxiliary posting", () => {
  beforeEach(() => dynamoMock.reset());

  test("posts a validated auxiliary line with snapshots and both existing indexes", async () => {
    mockPostingReads();
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await LedgerService.postEntry({
      orgId: "org-a",
      userId: "user-1",
      data,
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const lines = transaction.TransactItems?.filter((item) => item.Put)
      .slice(1)
      .map((item) => unmarshall(item.Put?.Item ?? {}));
    const customerLine = lines?.find(
      (line) => line.accountId === "41100000",
    );
    const revenueLine = lines?.find(
      (line) => line.accountId === "70100000",
    );

    expect(customerLine).toMatchObject({
      orgId: "org-a",
      accountId: "41100000",
      accountCode: "41100000",
      accountLabel: "Clients",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      thirdPartyCode: "CLI001",
      thirdPartyName: "Client A",
      postingOrdinal: 1,
      GSI2PK: "ORG#org-a#ACC#41100000#TP#TP-1",
      GSI3PK: "ORG#org-a#ACC#41100000#TP#TP-1",
      GSI3SK: "UNLETTERED#2026-03-15#E-fixed#0001",
    });
    expect(customerLine?.GSI2SK).toContain("DT#2026-03-15#");
    expect(revenueLine?.GSI2PK).toBeUndefined();
    expect(revenueLine?.GSI3PK).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("treats a retry of an already posted fixed entry as idempotent", async () => {
    mockPostingReads({
      orgId: "org-a",
      year: 2026,
      entryId: "E-fixed",
      entryType: "STANDARD",
      entryDate: "2026-03-15",
      journalCode: "SALES",
      label: "Customer invoice",
      totalDebit: 1000,
      totalCredit: 1000,
      status: "POSTED",
      entityType: "ENTRY",
      PK: "ORG#org-a#FY#2026",
      SK: "E#E-fixed",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    });
    dynamoMock.on(TransactWriteItemsCommand).rejects({
      name: "TransactionCanceledException",
    });

    await expect(
      LedgerService.postEntry({
        orgId: "org-a",
        userId: "user-1",
        data,
      }),
    ).resolves.toEqual({ entryId: "E-fixed" });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
  });
});
