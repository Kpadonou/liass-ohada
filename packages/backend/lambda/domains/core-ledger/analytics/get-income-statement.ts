import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import { z } from "zod";

/**
 * @description Structure of the Income Statement (Compte de Résultat).
 */
interface IncomeStatementResponse {
  fiscalYear: string;
  totalRevenue: number; // Class 7 - Produits
  totalExpenses: number; // Class 6 - Charges
  netResult: number; // Revenue - Expenses
  performanceStatus: "PROFIT" | "LOSS";
}

/**
 * @description Slim handler for the Income Statement.
 * It leverages pre-aggregated account balances for high performance.
 * - Class 6: Expenses (Charges)
 * - Class 7: Revenue (Produits)
 */
const IncomeStatementSchema = z.object({
  year: z.string().regex(/^\d{4}$/, "Year must be a 4-digit string"),
});

export const handler = createHandler(
  IncomeStatementSchema,
  async (data, { orgId, i18n }) => {
    const { year } = data;

    // 1. Fetch all balances for the year (one single efficient Query)
    const allBalances = await BalanceService.getTrialBalance(orgId, year);

    let totalExpenses = 0;
    let totalRevenue = 0;

    // 2. Aggregate totals based on account classes (6 and 7)
    allBalances.forEach((balance) => {
      const netBalance =
        balance.openingDebit +
        balance.movementDebit -
        (balance.openingCredit + balance.movementCredit);

      // Class 6: Expenses (Usually Debit balance)
      if (balance.accountId.startsWith("6")) {
        totalExpenses += netBalance;
      }

      // Class 7: Revenue (Usually Credit balance)
      // We take the negative of netBalance because Revenue is Credit-positive
      if (balance.accountId.startsWith("7")) {
        totalRevenue += -netBalance;
      }
    });

    const netResult = totalRevenue - totalExpenses;

    const response: IncomeStatementResponse = {
      fiscalYear: year,
      totalRevenue,
      totalExpenses,
      netResult,
      performanceStatus: netResult >= 0 ? "PROFIT" : "LOSS",
    };

    return {
      message: i18n.getMessage("SUCCESS_INCOME_STATEMENT_RETRIEVED"),
      data: response,
    };
  },
);
