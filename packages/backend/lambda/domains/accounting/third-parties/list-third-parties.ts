import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import { ListThirdPartiesRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  ListThirdPartiesRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_THIRD_PARTIES_RETRIEVED"),
    data: await ThirdPartyService.list(orgId, data),
  }),
);
