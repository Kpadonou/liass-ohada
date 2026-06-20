import {
  AccountBalanceResponseSchema,
  GeneralLedgerResponseSchema,
  JournalBookQuerySchema,
  JournalBookResponseSchema,
  TrialBalanceQuerySchema,
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
          label: "Report à nouveau",
          debit: 100,
          credit: 0,
          balance: 100,
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
    expect(response.data.openingBalance).not.toHaveProperty("journalCode");
  });

  test("general ledger normalizes legacy pagination and opening balance fields", () => {
    const baseData = {
      accountId: "41100000",
      openingBalance: {
        debit: 0,
        credit: 0,
        runningBalance: 0,
      },
      movements: [],
      finalBalance: 0,
    };

    const parsed = GeneralLedgerResponseSchema.parse({ data: baseData });

    expect(parsed.data.openingBalance).toEqual({
      debit: 0,
      credit: 0,
      balance: 0,
    });
    expect(parsed.data.hasMore).toBe(false);
  });

  test("general ledger movements still require a journal code", () => {
    expect(() =>
      GeneralLedgerResponseSchema.parse({
        data: {
          accountId: "41100000",
          openingBalance: { debit: 0, credit: 0, balance: 0 },
          movements: [
            {
              date: "2026-01-15",
              label: "Vente",
              debit: 100,
              credit: 0,
              runningBalance: 100,
            },
          ],
          finalBalance: 100,
          hasMore: false,
        },
      }),
    ).toThrow();
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
            accountCode: "41100000",
            accountLabel: "Clients",
            openingDebit: 100,
            openingCredit: 0,
            movementDebit: 50,
            movementCredit: 25,
            closingDebit: 125,
            closingCredit: 0,
          },
        ],
        totals: {
          openingDebit: 100,
          openingCredit: 0,
          movementDebit: 50,
          movementCredit: 25,
          closingDebit: 125,
          closingCredit: 0,
          isMovementBalanced: false,
          isClosingBalanced: false,
          movementDifference: 25,
          closingDifference: 125,
        },
        period: {
          fiscalYear: "2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
      },
    });

    expect(accountBalance.data).not.toHaveProperty("PK");
    expect(accountBalance.data).not.toHaveProperty("SK");
    expect(accountBalance.data).not.toHaveProperty("entityType");
    expect(trialBalance.data.rows[0]).not.toHaveProperty("GSI1PK");
  });

  test("trial balance contracts reject missing labels, negative amounts, and invalid periods", () => {
    expect(() =>
      TrialBalanceQuerySchema.parse({
        year: "2026",
        startDate: "2026-03-01",
        endDate: "2026-02-01",
      }),
    ).toThrow();

    expect(() =>
      TrialBalanceResponseSchema.parse({
        data: {
          rows: [
            {
              accountCode: "41100000",
              openingDebit: -1,
              openingCredit: 0,
              movementDebit: 0,
              movementCredit: 0,
              closingDebit: 0,
              closingCredit: 0,
            },
          ],
          totals: {
            openingDebit: 0,
            openingCredit: 0,
            movementDebit: 0,
            movementCredit: 0,
            closingDebit: 0,
            closingCredit: 0,
            isMovementBalanced: true,
            isClosingBalanced: true,
            movementDifference: 0,
            closingDifference: 0,
          },
          period: {
            fiscalYear: "2026",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
          },
        },
      }),
    ).toThrow();
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
