import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { CancelLetteringMatchRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CancelLetteringMatchRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_LETTERING_MATCH_CANCELLED"),
    data: await LetteringService.cancelMatch(orgId, userId, data),
  }),
);
