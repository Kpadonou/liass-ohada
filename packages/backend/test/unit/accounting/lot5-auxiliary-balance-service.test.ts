import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const fiscalYear = marshall({
  orgId: "org-a",
  year: 2026,
  fiscalYearId: "FY-2026",
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

const account = (
  accountId: string,
  auxiliaryType: "CUSTOMER" | "SUPPLIER" | "NONE",
) =>
  marshall({
    orgId: "org-a",
    accountId,
    accountName: accountId.startsWith("401") ? "Fournisseurs" : "Clients",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    isThirdPartyAccount: auxiliaryType !== "NONE",
    requiresThirdParty: auxiliaryType !== "NONE",
    auxiliaryType,
    classCode: 4,
    financialStatementCode: "BA",
    allowReconciliation: true,
    isActive: true,
    entityType: "ACCOUNT",
    PK: "ORG#org-a",
    SK: `ACC#${accountId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const thirdParty = (
  thirdPartyId: string,
  type: "CUSTOMER" | "SUPPLIER",
  displayName = type === "CUSTOMER" ? "Client Alpha" : "Fournisseur Beta",
) =>
  marshall({
    orgId: "org-a",
    thirdPartyId,
    code: type === "CUSTOMER" ? "CUST-ALPHA" : "SUP-BETA",
    displayName,
    type,
    status: "ACTIVE",
    entityType: "THIRD_PARTY",
    PK: "ORG#org-a",
    SK: `TP#${type}#${thirdPartyId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const line = (
  overrides: Partial<{
    orgId: string;
    accountId: string;
    thirdPartyId: string;
    thirdPartyType: "CUSTOMER" | "SUPPLIER";
    entryId: string;
    lineId: string;
    entryDate: string;
    journalCode: string;
    debit: number;
    credit: number;
    status: "POSTED" | "DRAFT";
    letteringStatus: "UNLETTERED" | "PARTIAL" | "LETTERED" | "COMPLETE";
    remainingAmount: number;
  }> = {},
) => {
  const accountId = overrides.accountId ?? "41110000";
  const thirdPartyId = overrides.thirdPartyId ?? "tp-cust-alpha";
  const entryDate = overrides.entryDate ?? "2026-03-15";
  const lineId = overrides.lineId ?? "L-1";
  const thirdPartyType = overrides.thirdPartyType ?? "CUSTOMER";
  return marshall(
    {
      orgId: overrides.orgId ?? "org-a",
      year: 2026,
      entryId: overrides.entryId ?? "E-1",
      lineId,
      status: overrides.status,
      accountId,
      accountCode: accountId,
      accountLabel: accountId.startsWith("401") ? "Fournisseurs" : "Clients",
      thirdPartyId,
      thirdPartyType,
      thirdPartyCode: thirdPartyType === "CUSTOMER" ? "CUST-ALPHA" : "SUP-BETA",
      thirdPartyName:
        thirdPartyType === "CUSTOMER" ? "Client Alpha" : "Fournisseur Beta",
      entryDate,
      journalCode: overrides.journalCode ?? "VT",
      debit: overrides.debit ?? 100,
      credit: overrides.credit ?? 0,
      label: "Pièce auxiliaire",
      letteringStatus: overrides.letteringStatus ?? "UNLETTERED",
      remainingAmount: overrides.remainingAmount,
      entityType: "ENTRY_LINE",
      PK: "ORG#org-a#FY#2026",
      SK: `L#${lineId}`,
      GSI2PK: `ORG#org-a#ACC#${accountId}#TP#${thirdPartyId}`,
      GSI2SK: `DT#${entryDate}#${lineId}`,
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    },
    { removeUndefinedValues: true },
  );
};

const mockFiscalYearAndAccount = (
  accountId = "41110000",
  auxiliaryType: "CUSTOMER" | "SUPPLIER" | "NONE" = "CUSTOMER",
) => {
  dynamoMock
    .on(GetItemCommand)
    .resolvesOnce({ Item: fiscalYear })
    .resolvesOnce({ Item: account(accountId, auxiliaryType) });
};

describe("Lot 5.5A auxiliary balance service", () => {
  beforeEach(() => dynamoMock.reset());

  test("lists third parties then queries GSI2 per third party without Scan or ConsistentRead", async () => {
    const lastEvaluatedKey = marshall({
      PK: "ORG#org-a",
      SK: "TP#CUSTOMER#tp-cust-alpha",
    });
    mockFiscalYearAndAccount();
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [thirdParty("tp-cust-alpha", "CUSTOMER")],
        LastEvaluatedKey: lastEvaluatedKey,
      })
      .resolvesOnce({
        Items: [
          line({
            entryId: "E-RAN",
            lineId: "L-RAN",
            entryDate: "2026-01-01",
            journalCode: "RAN",
            debit: 200,
            credit: 0,
            letteringStatus: "LETTERED",
          }),
          line({
            entryId: "E-BEFORE",
            lineId: "L-BEFORE",
            entryDate: "2026-01-15",
            debit: 0,
            credit: 50,
          }),
          line({
            entryId: "FAC-CUST-001",
            lineId: "L-FAC-1",
            entryDate: "2026-03-10",
            debit: 100000,
            credit: 0,
            remainingAmount: 100000,
          }),
          line({
            entryId: "PAY-CUST-001",
            lineId: "L-PAY-1",
            entryDate: "2026-03-20",
            debit: 0,
            credit: 40000,
            letteringStatus: "PARTIAL",
            remainingAmount: 60000,
          }),
          line({
            entryId: "E-DRAFT",
            lineId: "L-DRAFT",
            entryDate: "2026-03-25",
            debit: 999999,
            credit: 0,
            status: "DRAFT",
          }),
        ],
      });

    const result = await ThirdPartyService.getBalance("org-a", {
      fiscalYear: "2026",
      accountId: "41110000",
      thirdPartyType: "CUSTOMER",
      startDate: "2026-02-01",
      endDate: "2026-12-31",
      limit: 1,
    });
    const listQuery = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const ledgerQuery = dynamoMock.commandCalls(QueryCommand)[1].args[0].input;
    const ledgerValues = unmarshall(ledgerQuery.ExpressionAttributeValues!);

    expect(listQuery.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :prefix)",
    );
    expect(listQuery.IndexName).toBeUndefined();
    expect(ledgerQuery.IndexName).toBe("GSI2");
    expect(ledgerQuery.KeyConditionExpression).toBe(
      "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
    );
    expect(ledgerValues).toEqual({
      ":pk": "ORG#org-a#ACC#41110000#TP#tp-cust-alpha",
      ":start": "DT#2026-01-01#",
      ":end": "DT#2026-12-31#\uffff",
    });
    for (const call of dynamoMock.commandCalls(QueryCommand)) {
      expect(call.args[0].input.ConsistentRead).toBeUndefined();
    }
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      thirdPartyId: "tp-cust-alpha",
      thirdPartyName: "Client Alpha",
      accountCode: "41110000",
      openingDebit: 150,
      openingCredit: 0,
      movementDebit: 100000,
      movementCredit: 40000,
      closingDebit: 60150,
      closingCredit: 0,
      balance: 60150,
      unletteredAmount: 100050,
      remainingAmount: 160050,
    });
    expect(result.summary).toMatchObject({
      totalOpeningDebit: 150,
      totalOpeningCredit: 0,
      totalMovementDebit: 100000,
      totalMovementCredit: 40000,
      totalClosingDebit: 60150,
      totalClosingCredit: 0,
      thirdPartyCount: 1,
      balance: 60150,
    });
    expect((result.rows[0] as any).GSI2PK).toBeUndefined();
  });

  test("groups movements by listed third party", async () => {
    mockFiscalYearAndAccount();
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          thirdParty("tp-cust-alpha", "CUSTOMER", "Client Alpha"),
          thirdParty("tp-cust-gamma", "CUSTOMER", "Client Gamma"),
        ],
      })
      .resolvesOnce({
        Items: [
          line({ thirdPartyId: "tp-cust-alpha", debit: 500, credit: 0 }),
        ],
      })
      .resolvesOnce({
        Items: [
          line({
            thirdPartyId: "tp-cust-gamma",
            entryId: "PAY-GAMMA",
            lineId: "L-GAMMA",
            debit: 0,
            credit: 300,
          }),
        ],
      });

    const result = await ThirdPartyService.getBalance("org-a", {
      fiscalYear: "2026",
      accountId: "41110000",
      thirdPartyType: "CUSTOMER",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      thirdPartyName: "Client Alpha",
      movementDebit: 500,
      movementCredit: 0,
      closingDebit: 500,
      closingCredit: 0,
    });
    expect(result.rows[1]).toMatchObject({
      thirdPartyName: "Client Gamma",
      movementDebit: 0,
      movementCredit: 300,
      closingDebit: 0,
      closingCredit: 300,
      balance: -300,
    });
  });

  test("rejects a non-auxiliary account before querying third-party balances", async () => {
    mockFiscalYearAndAccount("70100000", "NONE");

    await expect(
      ThirdPartyService.getBalance("org-a", {
        fiscalYear: "2026",
        accountId: "70100000",
        thirdPartyType: "CUSTOMER",
      }),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_NOT_ALLOWED" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("rejects account and third-party type mismatches", async () => {
    mockFiscalYearAndAccount("41110000", "CUSTOMER");

    await expect(
      ThirdPartyService.getBalance("org-a", {
        fiscalYear: "2026",
        accountId: "41110000",
        thirdPartyType: "SUPPLIER",
      }),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_TYPE_MISMATCH" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("rejects a foreign third-party pagination cursor", async () => {
    const foreignCursor = Buffer.from(
      JSON.stringify(
        marshall({
          PK: "ORG#org-b",
          SK: "TP#CUSTOMER#tp-cust-alpha",
        }),
      ),
    ).toString("base64");
    mockFiscalYearAndAccount();

    await expect(
      ThirdPartyService.getBalance("org-a", {
        fiscalYear: "2026",
        accountId: "41110000",
        thirdPartyType: "CUSTOMER",
        cursor: foreignCursor,
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("supports the seeded supplier balance shape", async () => {
    mockFiscalYearAndAccount("40110000", "SUPPLIER");
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [thirdParty("tp-sup-beta", "SUPPLIER")] })
      .resolvesOnce({
        Items: [
          line({
            accountId: "40110000",
            thirdPartyId: "tp-sup-beta",
            thirdPartyType: "SUPPLIER",
            entryId: "INV-SUP-001",
            lineId: "L-INV-SUP-1",
            debit: 0,
            credit: 80000,
          }),
          line({
            accountId: "40110000",
            thirdPartyId: "tp-sup-beta",
            thirdPartyType: "SUPPLIER",
            entryId: "PAY-SUP-001",
            lineId: "L-PAY-SUP-1",
            debit: 80000,
            credit: 0,
          }),
        ],
      });

    const result = await ThirdPartyService.getBalance("org-a", {
      fiscalYear: "2026",
      accountId: "40110000",
      thirdPartyType: "SUPPLIER",
    });

    expect(result.rows[0]).toMatchObject({
      thirdPartyId: "tp-sup-beta",
      thirdPartyType: "SUPPLIER",
      thirdPartyName: "Fournisseur Beta",
      movementDebit: 80000,
      movementCredit: 80000,
      closingDebit: 0,
      closingCredit: 0,
      balance: 0,
    });
  });
});
