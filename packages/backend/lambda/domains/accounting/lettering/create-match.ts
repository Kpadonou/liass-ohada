import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { CreateLetteringMatchRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CreateLetteringMatchRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LetteringService.createManualMatch(
      orgId,
      userId,
      data,
    );

    return {
      message: i18n.getMessage("SUCCESS_LETTERING_MATCH_CREATED"),
      data: result,
    };
  },
  {
    action: "POST /lettering/matches",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
