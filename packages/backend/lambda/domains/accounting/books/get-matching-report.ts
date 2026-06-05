import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { z } from "zod";

/**
 * @description Validation schema for the Matching/Lettering report.
 */
const GetMatchingReportSchema = z.object({
  accountId: z.string().min(2),
  thirdPartyId: z.string().min(1),
});

/**
 * @description Slim handler to retrieve the Lettering report for a third-party account.
 * It separates transactions into "Lettered Groups" and "Unlettered (Outstanding) Lines".
 */
export const handler = createHandler(
  GetMatchingReportSchema,
  async (data, { orgId, i18n }) => {
    const { accountId, thirdPartyId } = data;

    // We delegate the heavy lifting to the LetteringService
    const report = await LetteringService.getThirdPartyReport(
      orgId,
      accountId,
      thirdPartyId,
    );

    return {
      message: i18n.getMessage("SUCCESS_MATCHING_REPORT_RETRIEVED"),
      data: {
        accountId,
        thirdPartyId,
        ...report,
      },
    };
  },
);
