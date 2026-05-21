import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProjectService } from "@/lambda/shared/services/project-service";
import { z } from "zod";

const GetProjectReportSchema = z.object({
  projectId: z.string().min(1),
  year: z.coerce.string().regex(/^\d{4}$/).default("2026"),
});

export const handler = createHandler(
  GetProjectReportSchema,
  async (data, { orgId, i18n }) => {
    const report = await ProjectService.getProjectReport(
      orgId,
      data.projectId,
      data.year,
    );

    return {
      message: i18n.getMessage("SUCCESS_PROJECT_REPORT_RETRIEVED"),
      data: report,
    };
  },
);
