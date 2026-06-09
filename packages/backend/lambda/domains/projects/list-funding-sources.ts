import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProjectService } from "@/lambda/shared/services/project-service";
import { z } from "zod";

const ListFundingSourcesSchema = z.object({
  projectId: z.string().min(1),
});

export const handler = createHandler(
  ListFundingSourcesSchema,
  async (data, { orgId, i18n }) => {
    const fundingSources = await ProjectService.listFundingSources(
      orgId,
      data.projectId,
    );

    return {
      message: i18n.getMessage("SUCCESS_FUNDING_SOURCES_RETRIEVED"),
      data: {
        fundingSources,
      },
    };
  },
);
