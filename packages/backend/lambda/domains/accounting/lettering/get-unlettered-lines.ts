import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { z } from "zod";

const GetUnletteredLinesSchema = z.object({
  accountId: z.string().min(1),
  thirdPartyId: z.string().min(1),
  projectId: z.string().optional(),
});

export const handler = createHandler(
  GetUnletteredLinesSchema,
  async (data, { orgId, i18n }) => {
    const result = await LetteringService.getUnletteredLines(
      orgId,
      data.accountId,
      data.thirdPartyId,
      data.projectId,
    );

    return {
      message: i18n.getMessage(
        result.totalUnlettered === 0
          ? "INFO_NO_LINES_TO_MATCH"
          : "SUCCESS_SUGGESTIONS_RETRIEVED",
      ),
      ...result,
    };
  },
  {
    action: "GET /lettering/unlettered",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
