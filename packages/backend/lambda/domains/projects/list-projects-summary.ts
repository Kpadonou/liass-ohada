import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProjectService } from "@/lambda/shared/services/project-service";
import { z } from "zod";

const currentYear = () => String(new Date().getFullYear());

const ListProjectsSummarySchema = z.object({
  year: z.coerce.string().regex(/^\d{4}$/).default(currentYear),
});

export const handler = createHandler(
  ListProjectsSummarySchema,
  async (data, { orgId, i18n }) => {
    const dashboard = await ProjectService.getProjectsSummary(orgId, data.year);

    return {
      message: i18n.getMessage("SUCCESS_PROJECTS_LISTED"),
      data: dashboard,
    };
  },
);
