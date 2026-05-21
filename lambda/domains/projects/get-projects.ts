import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProjectService } from "@/lambda/shared/services/project-service";
import { z } from "zod";

const GetProjectsSchema = z.object({
  projectId: z.string().optional(),
});

export const handler = createHandler(
  GetProjectsSchema,
  async (data, { orgId, i18n }) => {
    if (data.projectId) {
      const project = await ProjectService.getProject(orgId, data.projectId);
      return {
        message: i18n.getMessage("SUCCESS_PROJECT_RETRIEVED"),
        project,
      };
    }

    const projects = await ProjectService.listProjects(orgId);
    return {
      message: i18n.getMessage("SUCCESS_PROJECTS_LISTED"),
      count: projects.length,
      projects,
    };
  },
);
