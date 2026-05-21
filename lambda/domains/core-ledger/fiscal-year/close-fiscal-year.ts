import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import { z } from "zod";

const CloseYearSchema = z.object({
  year: z.coerce.string().regex(/^\d{4}$/),
});

export const handler = createHandler(
  CloseYearSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await FiscalYearService.closeYear(orgId, userId, data.year);

    return {
      message: i18n.getMessage("SUCCESS_YEAR_END_CLOSED"),
      data: result,
    };
  },
);
