/**
 * @description Slim handler for fiscal period locking and unlocking.
 * - Validates payload (year, month, status) via zod schema.
 * - Ensures that if a fiscal year is CLOSED, the period cannot be changed.
 * - Delegates persistence to LockService.updatePeriodLock.
 * - Once a period is LOCKED, post-entry and lettering services must reject entries for that period.
 */
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import { z } from "zod";

const LockPeriodSchema = z.object({
  year: z.number().int().gte(1900),
  month: z.number().int().gte(1).lte(12),
  status: z.enum(["LOCKED", "OPEN"]),
});

export const handler = createHandler(
  LockPeriodSchema,
  async (data, { orgId, userId, i18n }) => {
    const lockItem = await FiscalYearService.updatePeriodLock(
      orgId,
      userId,
      data.year,
      data.month,
      data.status,
    );

    const successMessage =
      data.status === "LOCKED"
        ? i18n.getMessage("SUCCESS_PERIOD_LOCKED")
        : i18n.getMessage("SUCCESS_PERIOD_UNLOCKED");

    return {
      message: successMessage,
      lockItem,
    };
  },
);
