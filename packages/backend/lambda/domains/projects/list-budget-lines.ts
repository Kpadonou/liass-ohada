import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProjectService } from "@/lambda/shared/services/project-service";
import { z } from "zod";

const currentYear = () => String(new Date().getFullYear());

const ListBudgetLinesSchema = z.object({
  projectId: z.string().min(1),
  year: z.coerce.string().regex(/^\d{4}$/).default(currentYear),
});

export const handler = createHandler(
  ListBudgetLinesSchema,
  async (data, { orgId, i18n }) => {
    const budgetLines = await ProjectService.listBudgetLines(
      orgId,
      data.projectId,
      data.year,
    );

    return {
      message: i18n.getMessage("SUCCESS_BUDGET_LINES_RETRIEVED"),
      data: {
        budgetLines,
      },
    };
  },
  { permission: "PROJECTS_READ" },
);
