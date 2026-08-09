import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  CreateProjectInputSchema,
  ProjectService,
} from "@/lambda/domains/projects/services/project-service";

export const handler = createHandler(
  CreateProjectInputSchema,
  async (data, { orgId, userId, i18n }) => {
    const project = await ProjectService.createProject(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_PROJECT_CREATED"),
      data: project,
    };
  },
  {
    action: "POST /projects",
    permission: "PROJECTS_WRITE",
    productCode: "ACCOUNTING",
  },
);
