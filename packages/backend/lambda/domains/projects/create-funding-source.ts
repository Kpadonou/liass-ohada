import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  CreateFundingSourceInputSchema,
  ProjectService,
} from "@/lambda/domains/projects/services/project-service";
import { z } from "zod";

const CreateProjectFundingSourceSchema = CreateFundingSourceInputSchema.extend({
  projectId: z.string().min(1),
});

export const handler = createHandler(
  CreateProjectFundingSourceSchema,
  async (data, { orgId, userId, i18n }) => {
    const fundingSource = await ProjectService.createFundingSource(
      orgId,
      userId,
      data.projectId,
      data,
    );

    return {
      message: i18n.getMessage("SUCCESS_FUNDING_SOURCE_CREATED"),
      data: fundingSource,
    };
  },
  {
    action: "POST /projects/{projectId}/funding-sources",
    permission: "PROJECTS_WRITE",
    productCode: "ACCOUNTING",
  },
);
