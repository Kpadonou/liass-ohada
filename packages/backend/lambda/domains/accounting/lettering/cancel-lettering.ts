import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { CancelLetteringRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CancelLetteringRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LetteringService.cancelLettering(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_UNLETTERING_COMPLETED"),
      ...result,
    };
  },
  {
    action: "POST /lettering/cancel",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
