import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import {
  ClosePeriodRequestSchema,
  ClosePeriodResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  ClosePeriodRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const lock = await FiscalYearService.closePeriod(
      orgId,
      userId,
      data.year,
      data.month,
    );

    return ClosePeriodResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_PERIOD_LOCKED"),
      data: lock,
    });
  },
  {
    action: "POST /fiscal-year/{year}/periods/{month}/close",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
