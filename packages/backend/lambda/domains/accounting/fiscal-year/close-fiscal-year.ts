import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import {
  CloseFiscalYearRequestSchema,
  CloseFiscalYearResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CloseFiscalYearRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await FiscalYearService.closeYear(
      orgId,
      userId,
      data.year,
      data.confirmWarnings,
    );

    return CloseFiscalYearResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_YEAR_END_CLOSED"),
      data: result,
    });
  },
);
