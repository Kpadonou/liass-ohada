import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import { ClosingChecksResponseSchema } from "@liass-ohada/shared/accounting";
import { z } from "zod";

const GetClosingChecksSchema = z.object({
  year: z.coerce.string().regex(/^\d{4}$/),
});

export const handler = createHandler(
  GetClosingChecksSchema,
  async (data, { orgId, i18n }) => {
    const checks = await FiscalYearService.getClosingChecks(orgId, data.year);

    return ClosingChecksResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_CLOSING_CHECKS_RETRIEVED"),
      data: checks,
    });
  },
);
