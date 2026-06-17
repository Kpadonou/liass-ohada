import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import { CreateFiscalYearRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CreateFiscalYearRequestSchema,
  async (data, { orgId, userId, accountingFramework, i18n }) => {
    const fiscalYear = await FiscalYearService.createFiscalYear(
      orgId,
      userId,
      data,
      accountingFramework,
    );

    return {
      message: i18n.getMessage("SUCCESS_FISCAL_YEAR_CREATED"),
      data: fiscalYear,
    };
  },
);
