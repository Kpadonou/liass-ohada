import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  CreateBudgetLineInputSchema,
  ProjectService,
} from "@/lambda/shared/services/project-service";
import { z } from "zod";

const CreateProjectBudgetLineSchema = CreateBudgetLineInputSchema.extend({
  projectId: z.string().min(1),
});

export const handler = createHandler(
  CreateProjectBudgetLineSchema,
  async (data, { orgId, userId, i18n }) => {
    const budgetLine = await ProjectService.createBudgetLine(
      orgId,
      userId,
      data.projectId,
      data,
    );

    return {
      message: i18n.getMessage("SUCCESS_BUDGET_LINE_CREATED"),
      data: budgetLine,
    };
  },
);
