import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
import { ListReconciliationMatchesRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  ListReconciliationMatchesRequestSchema,
  async (data, { orgId, i18n }) => {
    const result = await TreasuryService.listReconciliationMatches(orgId, data);

    return {
      message: i18n.getMessage("SUCCESS_RECONCILIATIONS_LISTED"),
      data: result,
    };
  },
);
