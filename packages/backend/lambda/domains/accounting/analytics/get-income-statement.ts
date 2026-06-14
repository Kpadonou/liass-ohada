import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { z } from "zod";

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
    const response = await LedgerService.getIncomeStatement(
      orgId,
      Number(data.year),
    );

    return {
      message: i18n.getMessage("SUCCESS_INCOME_STATEMENT_RETRIEVED"),
      data: response,
    };
  },
);
