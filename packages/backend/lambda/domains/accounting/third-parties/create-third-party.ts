import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import { CreateThirdPartyRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CreateThirdPartyRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_THIRD_PARTY_CREATED"),
    thirdParty: await ThirdPartyService.create(orgId, data),
  }),
  {
    action: "POST /third-parties",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
