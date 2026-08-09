import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { PostLetteringRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  PostLetteringRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LetteringService.postLettering(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_LETTERING_CONFIRMED"),
      ...result,
    };
  },
  {
    action: "POST /lettering",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
