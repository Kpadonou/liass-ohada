import {
  ThirdPartyBalanceQuerySchema,
  ThirdPartyBalanceResponseSchema,
} from "@liass-ohada/shared/accounting";

describe("Lot 5.5A auxiliary balance shared contracts", () => {
  test("request schema validates one auxiliary account balance context", () => {
    const query = ThirdPartyBalanceQuerySchema.parse({
      fiscalYear: "2026",
      accountId: "411",
      thirdPartyType: "CUSTOMER",
      status: "ACTIVE",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      limit: "25",
    });

    expect(query).toMatchObject({
      fiscalYear: "2026",
      accountId: "411",
      thirdPartyType: "CUSTOMER",
      status: "ACTIVE",
      limit: 25,
    });
  });

  test("request schema rejects dates outside or inverted within the fiscal year", () => {
    expect(() =>
      ThirdPartyBalanceQuerySchema.parse({
        fiscalYear: "2026",
        accountId: "411",
        thirdPartyType: "CUSTOMER",
        startDate: "2025-12-31",
      }),
    ).toThrow();

    expect(() =>
      ThirdPartyBalanceQuerySchema.parse({
        fiscalYear: "2026",
        accountId: "411",
        thirdPartyType: "CUSTOMER",
        startDate: "2026-03-01",
        endDate: "2026-02-01",
      }),
    ).toThrow();
  });

  test("response schema strips DynamoDB internals and normalizes pagination", () => {
    const response = ThirdPartyBalanceResponseSchema.parse({
      data: {
        PK: "ORG#technical",
        accountId: "41110000",
        thirdPartyType: "CUSTOMER",
        account: {
          GSI2PK: "technical",
          accountId: "41110000",
          accountName: "Clients",
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
        period: {
          fiscalYear: "2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
        rows: [
          {
            SK: "technical",
            thirdPartyId: "tp-cust-alpha",
            thirdPartyType: "CUSTOMER",
            thirdPartyCode: "CUST-ALPHA",
            thirdPartyName: "Client Alpha",
            accountId: "41110000",
            accountCode: "41110000",
            accountLabel: "Clients",
            openingDebit: 0,
            openingCredit: 0,
            movementDebit: 1000,
            movementCredit: 400,
            closingDebit: 600,
            closingCredit: 0,
            balance: 600,
            remainingAmount: 600,
            letteringStatusSummary: {
              unlettered: 1,
              partial: 0,
              lettered: 0,
              remainingAmount: 600,
            },
          },
        ],
        summary: {
          totalOpeningDebit: 0,
          totalOpeningCredit: 0,
          totalMovementDebit: 1000,
          totalMovementCredit: 400,
          totalClosingDebit: 600,
          totalClosingCredit: 0,
          thirdPartyCount: 1,
          balance: 600,
        },
        count: 1,
      },
    });

    expect(response.data).not.toHaveProperty("PK");
    expect(response.data.account).not.toHaveProperty("GSI2PK");
    expect(response.data.rows[0]).not.toHaveProperty("SK");
    expect(response.data.hasMore).toBe(false);
  });
});
