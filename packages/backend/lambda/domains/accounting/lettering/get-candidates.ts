import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { LetteringCandidatesQuerySchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  LetteringCandidatesQuerySchema,
  async (data, { orgId, i18n }) => {
    const result = await LetteringService.listCandidates(orgId, data);

    return {
      message: i18n.getMessage(
        result.lines.length === 0
          ? "INFO_NO_LINES_TO_MATCH"
          : "SUCCESS_LETTERING_CANDIDATES_RETRIEVED",
      ),
      data: result,
    };
  },
  {
    action: "GET /lettering/candidates",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
