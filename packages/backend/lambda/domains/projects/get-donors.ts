import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProjectService } from "@/lambda/shared/services/project-service";
import { z } from "zod";

const ListDonorsSchema = z.object({});

export const handler = createHandler(
  ListDonorsSchema,
  async (data, { orgId, i18n }) => {
    const donors = await ProjectService.listDonors(orgId);

    return {
      message: i18n.getMessage("SUCCESS_DONORS_RETRIEVED"),
      data: {
        donors,
      },
    };
  },
);
