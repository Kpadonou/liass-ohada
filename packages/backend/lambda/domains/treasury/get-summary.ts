import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
import { z } from "zod";

const currentYear = () => String(new Date().getFullYear());

const GetSummarySchema = z.object({
  year: z.coerce.string().regex(/^\d{4}$/).default(currentYear),
});

export const handler = createHandler(
  GetSummarySchema,
  async (data, { orgId, i18n }) => {
    const summary = await TreasuryService.getSummary(orgId, data.year);

    return {
      message: i18n.getMessage("SUCCESS_TREASURY_SUMMARY_RETRIEVED"),
      data: summary,
    };
  },
  {
    action: "GET /treasury/summary",
    permission: "TREASURY_READ",
    productCode: "TREASURY",
  },
);
