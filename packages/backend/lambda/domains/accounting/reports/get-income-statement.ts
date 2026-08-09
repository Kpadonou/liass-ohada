import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { z } from "zod";

const IncomeStatementRequestSchema = z.object({
  year: z.coerce.number().int().gte(1900),
});

export const handler = createHandler(
  IncomeStatementRequestSchema,
  async (data, { orgId, i18n }) => {
    const statement = await LedgerService.getIncomeStatement(orgId, data.year);

    return {
      message: i18n.getMessage("SUCCESS_INCOME_STATEMENT_RETRIEVED"),
      data: statement,
    };
  },
  {
    action: "GET /reports/income-statement",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
