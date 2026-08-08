import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  CreateDonorInputSchema,
  ProjectService,
} from "@/lambda/shared/services/project-service";

export const handler = createHandler(
  CreateDonorInputSchema,
  async (data, { orgId, userId, i18n }) => {
    const donor = await ProjectService.createDonor(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_DONOR_CREATED"),
      data: donor,
    };
  },
  { permission: "PROJECTS_WRITE" },
);
