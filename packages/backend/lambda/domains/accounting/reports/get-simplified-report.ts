import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SimplifiedReportingService } from "@/lambda/shared/services/simplified-reporting-service";
import {
  SimplifiedReportQuerySchema,
  SimplifiedReportResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  SimplifiedReportQuerySchema,
  async (data, { orgId, i18n }) => {
    const report = await SimplifiedReportingService.getSimplifiedReport(
      orgId,
      data,
    );

    return SimplifiedReportResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_SIMPLIFIED_REPORT_RETRIEVED"),
      data: report,
    });
  },
);
