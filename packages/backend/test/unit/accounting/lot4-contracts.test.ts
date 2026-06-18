import {
  AccountBalanceResponseSchema,
  GeneralLedgerResponseSchema,
  JournalBookQuerySchema,
  JournalBookResponseSchema,
  TrialBalanceResponseSchema,
} from "@liass-ohada/shared/accounting";

describe("frontend-safe Accounting Lot 4 contracts", () => {
  test("general ledger response strips persistence attributes", () => {
    const response = GeneralLedgerResponseSchema.parse({
      data: {
        PK: "ORG#technical",
        accountId: "41100000",
        openingBalance: {
          GSI1PK: "ORG#technical",
          date: "OPENING",
          label: "Report à nouveau",
          reference: "RAN",
          journalCode: "RAN",
          debit: 100,
          credit: 0,
          runningBalance: 100,
        },
        movements: [
          {
            SK: "L#technical",
            date: "2026-01-15",
            label: "Vente",
            reference: "FV-001",
            journalCode: "VE",
            entryId: "E-001",
            lineId: "L-001",
            debit: 100,
            credit: 0,
            runningBalance: 200,
          },
        ],
        finalBalance: 200,
        hasMore: false,
      },
    });

    expect(response.data).not.toHaveProperty("PK");
    expect(response.data.openingBalance).not.toHaveProperty("GSI1PK");
    expect(response.data.movements[0]).not.toHaveProperty("SK");
  });

  test("balance schemas expose six business columns only", () => {
    const accountBalance = AccountBalanceResponseSchema.parse({
      data: {
        PK: "ORG#technical",
        SK: "BAL#41100000",
        entityType: "ACCOUNT_BALANCE",
        accountId: "41100000",
        openingDebit: 100,
        openingCredit: 0,
        movementDebit: 50,
        movementCredit: 25,
        finalDebit: 125,
        finalCredit: 0,
      },
    });
    const trialBalance = TrialBalanceResponseSchema.parse({
      data: {
        rows: [
          {
            GSI1PK: "ORG#technical",
            accountId: "41100000",
            openingDebit: 100,
            openingCredit: 0,
            movementDebit: 50,
            movementCredit: 25,
            finalDebit: 125,
            finalCredit: 0,
          },
        ],
        totals: {
          openingDebit: 100,
          openingCredit: 0,
          movementDebit: 50,
          movementCredit: 25,
          finalDebit: 125,
          finalCredit: 0,
        },
      },
    });

    expect(accountBalance.data).not.toHaveProperty("PK");
    expect(accountBalance.data).not.toHaveProperty("SK");
    expect(accountBalance.data).not.toHaveProperty("entityType");
    expect(trialBalance.data.rows[0]).not.toHaveProperty("GSI1PK");
  });

  test("journal book requires a journal and strips technical attributes", () => {
    expect(() =>
      JournalBookQuerySchema.parse({
        year: "2026",
      }),
    ).toThrow();

    const response = JournalBookResponseSchema.parse({
      data: {
        meta: {
          year: "2026",
          journalCode: "VE",
        },
        entries: [
          {
            PK: "ORG#technical",
            GSI5PK: "ORG#technical",
            entityType: "ENTRY",
            entryId: "E-001",
            date: "2026-01-15",
            journalCode: "VE",
            totalDebit: 100,
            totalCredit: 100,
            status: "POSTED",
          },
        ],
        hasMore: false,
      },
    });

    expect(response.data.entries[0]).not.toHaveProperty("PK");
    expect(response.data.entries[0]).not.toHaveProperty("GSI5PK");
    expect(response.data.entries[0]).not.toHaveProperty("entityType");
  });
});
