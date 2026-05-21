import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import { z } from "zod";

const UnlockPeriodSchema = z.object({
  year: z.coerce.number().int().gte(1900),
  month: z.coerce.number().int().gte(1).lte(12),
});

export const handler = createHandler(
  UnlockPeriodSchema,
  async (data, { orgId, userId, i18n }) => {
    const lockItem = await FiscalYearService.updatePeriodLock(
      orgId,
      userId,
      data.year,
      data.month,
      "OPEN",
    );

    return {
      message: i18n.getMessage("SUCCESS_PERIOD_UNLOCKED"),
      lockItem,
    };
  },
);
