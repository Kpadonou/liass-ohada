import {
  ThirdPartyLedgerQuerySchema,
  ThirdPartyLedgerResponseSchema,
} from "@liass-ohada/shared/accounting";

const movement = {
  date: "2026-03-15",
  label: "Facture client",
  reference: "FV-001",
  journalCode: "VE",
  debit: 1000,
  credit: 0,
  runningBalance: 1000,
  letteringCode: null,
  letteringStatus: "UNLETTERED",
  entryId: "E-1",
  lineId: "L-1",
};

describe("Lot 5.4A auxiliary ledger shared contracts", () => {
  test("request schema validates one auxiliary account ledger context", () => {
    const query = ThirdPartyLedgerQuerySchema.parse({
      fiscalYear: "2026",
      accountId: "411",
      thirdPartyId: "tp-cust-alpha",
      thirdPartyType: "CUSTOMER",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      limit: "25",
    });

    expect(query).toMatchObject({
      fiscalYear: "2026",
      accountId: "411",
      thirdPartyId: "tp-cust-alpha",
      thirdPartyType: "CUSTOMER",
      limit: 25,
    });
  });

  test("request schema rejects dates outside or inverted within the fiscal year", () => {
    expect(() =>
      ThirdPartyLedgerQuerySchema.parse({
        fiscalYear: "2026",
        accountId: "411",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER",
        startDate: "2025-12-31",
      }),
    ).toThrow();

    expect(() =>
      ThirdPartyLedgerQuerySchema.parse({
        fiscalYear: "2026",
        accountId: "411",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER",
        startDate: "2026-03-01",
        endDate: "2026-02-01",
      }),
    ).toThrow();
  });

  test("response schema strips DynamoDB internals and normalizes pagination", () => {
    const response = ThirdPartyLedgerResponseSchema.parse({
      data: {
        PK: "ORG#technical",
        accountId: "41110000",
        thirdPartyId: "tp-cust-alpha",
        thirdPartyType: "CUSTOMER",
        account: {
          GSI2PK: "technical",
          accountId: "41110000",
          accountName: "Clients - Alpha",
          accountNature: "BALANCE",
          accountUsage: "BOTH",
          isThirdPartyAccount: true,
          requiresThirdParty: true,
          auxiliaryType: "CUSTOMER",
          classCode: 4,
          financialStatementCode: "BA",
          allowReconciliation: true,
          isActive: true,
        },
        thirdParty: {
          SK: "technical",
          thirdPartyId: "tp-cust-alpha",
          code: "CUST-ALPHA",
          displayName: "Client Alpha",
          type: "CUSTOMER",
          status: "ACTIVE",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        period: {
          fiscalYear: "2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
        openingBalance: {
          debit: 0,
          credit: 0,
          runningBalance: 0,
        },
        movements: [{ ...movement, GSI2SK: "technical" }],
        summary: {
          totalDebit: 1000,
          totalCredit: 0,
          balance: 1000,
        },
        count: 1,
        finalBalance: 1000,
      },
    });

    expect(response.data).not.toHaveProperty("PK");
    expect(response.data.account).not.toHaveProperty("GSI2PK");
    expect(response.data.thirdParty).not.toHaveProperty("SK");
    expect(response.data.movements[0]).not.toHaveProperty("GSI2SK");
    expect(response.data.lines[0]).not.toHaveProperty("GSI2SK");
    expect(response.data.openingBalance).toEqual({
      debit: 0,
      credit: 0,
      balance: 0,
    });
    expect(response.data.hasMore).toBe(false);
  });
});
