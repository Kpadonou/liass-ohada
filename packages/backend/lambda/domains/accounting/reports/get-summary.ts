import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SimplifiedReportingService } from "@/lambda/shared/services/simplified-reporting-service";
import {
  SummaryReportQuerySchema,
  SummaryReportResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  SummaryReportQuerySchema,
  async (data, { orgId, i18n }) => {
    const report = await SimplifiedReportingService.getSummaryReport(
      orgId,
      data,
    );

    return SummaryReportResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_SUMMARY_REPORT_RETRIEVED"),
      data: report,
    });
  },
  {
    action: "GET /reports/summary",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
