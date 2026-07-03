import {
  SimplifiedReportQuerySchema,
  SimplifiedReportResponseSchema,
  SummaryReportQuerySchema,
  SummaryReportResponseSchema,
} from "@liass-ohada/shared/accounting";

describe("Lot 6.3 simplified reporting shared contracts", () => {
  test("request schema validates fiscal year, optional dates, and boolean flags", () => {
    const query = SummaryReportQuerySchema.parse({
      fiscalYear: "2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      includeAuxiliary: "false",
      includeClosingChecks: "true",
    });

    expect(query).toEqual({
      fiscalYear: "2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      includeAuxiliary: false,
      includeClosingChecks: true,
    });
  });

  test("request schema rejects inverted or outside fiscal-year dates", () => {
    expect(() =>
      SummaryReportQuerySchema.parse({
        fiscalYear: "2026",
        startDate: "2025-12-31",
      }),
    ).toThrow();

    expect(() =>
      SummaryReportQuerySchema.parse({
        fiscalYear: "2026",
        startDate: "2026-03-01",
        endDate: "2026-02-01",
      }),
    ).toThrow();
  });

  test("response schema validates all sections and strips technical fields", () => {
    const response = SummaryReportResponseSchema.parse({
      message: "ok",
      data: {
        PK: "ORG#technical",
        period: {
          fiscalYear: "2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          generatedAt: "2026-07-01T00:00:00.000Z",
          entityType: "REPORT",
        },
        trialBalance: {
          totalDebit: 150000,
          totalCredit: 150000,
          isBalanced: true,
          accountCount: 3,
          movementCount: 2,
          SK: "TECHNICAL",
        },
        income: {
          totalRevenue: 100000,
          totalExpense: 40000,
          netResult: 60000,
          revenueAccounts: [
            {
              accountId: "70100000",
              totalDebit: 0,
              totalCredit: 100000,
              netAmount: 100000,
              GSI1PK: "TECHNICAL",
            },
          ],
          expenseAccounts: [
            {
              accountId: "60100000",
              totalDebit: 40000,
              totalCredit: 0,
              netAmount: 40000,
            },
          ],
        },
        auxiliary: {
          customers: {
            accountIds: ["41100000"],
            totalDebit: 100000,
            totalCredit: 30000,
            totalBalanceDebit: 70000,
            totalBalanceCredit: 0,
            unletteredAmount: 70000,
            thirdPartyCount: 1,
            entityType: "TECHNICAL",
          },
          suppliers: {
            accountIds: ["40100000"],
            totalDebit: 20000,
            totalCredit: 50000,
            totalBalanceDebit: 0,
            totalBalanceCredit: 30000,
          },
        },
        closingReadiness: {
          canClose: true,
          errorsCount: 0,
          warningsCount: 1,
          draftEntriesCount: 0,
          unbalancedEntriesCount: 0,
          unletteredAuxiliaryLinesCount: 3,
          GSI2SK: "TECHNICAL",
        },
      },
    });

    expect(response.data).not.toHaveProperty("PK");
    expect(response.data.period).not.toHaveProperty("entityType");
    expect(response.data.trialBalance).not.toHaveProperty("SK");
    expect(response.data.income.revenueAccounts?.[0]).not.toHaveProperty(
      "GSI1PK",
    );
    expect(response.data.auxiliary?.customers).not.toHaveProperty("entityType");
    expect(response.data.closingReadiness).not.toHaveProperty("GSI2SK");
  });

  test("deprecated simplified contract exports stay equivalent to summary contracts", () => {
    expect(SimplifiedReportQuerySchema).toBe(SummaryReportQuerySchema);
    expect(SimplifiedReportResponseSchema).toBe(SummaryReportResponseSchema);
  });
});
