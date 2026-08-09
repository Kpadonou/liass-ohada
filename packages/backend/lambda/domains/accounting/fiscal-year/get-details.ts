import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalYearService } from "@/lambda/shared/services/fiscal-year-service";
import { z } from "zod";

const GetFiscalYearDetailsSchema = z.object({
  year: z.coerce.string().regex(/^\d{4}$/),
});

export const handler = createHandler(
  GetFiscalYearDetailsSchema,
  async (data, { orgId, i18n }) => {
    const details = await FiscalYearService.getDetails(orgId, data.year);

    return {
      message: i18n.getMessage("SUCCESS_FISCAL_YEAR_DETAILS_RETRIEVED"),
      data: details,
    };
  },
  {
    action: "GET /fiscal-year/{year}",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
