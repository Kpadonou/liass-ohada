import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import { GetThirdPartyRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  GetThirdPartyRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_THIRD_PARTY_RETRIEVED"),
    thirdParty: await ThirdPartyService.get(
      orgId,
      data.type,
      data.thirdPartyId,
    ),
  }),
  {
    action: "GET /third-parties/{thirdPartyId}",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
