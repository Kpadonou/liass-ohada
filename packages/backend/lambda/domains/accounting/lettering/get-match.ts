import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { GetLetteringMatchRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  GetLetteringMatchRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_LETTERING_MATCH_RETRIEVED"),
    data: await LetteringService.getMatch(
      orgId,
      data.fiscalYear,
      data.letteringId,
    ),
  }),
  {
    action: "GET /lettering/matches/{letteringId}",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
