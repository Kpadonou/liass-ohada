import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  ThirdPartyLedgerQuerySchema,
  ThirdPartyLedgerResponseSchema,
} from "@liass-ohada/shared/accounting";

/**
 * @description Slim handler to retrieve the chronological history of a third-party account.
 * Uses GSI2 for optimized date-range queries.
 */
export const handler = createHandler(
  ThirdPartyLedgerQuerySchema,
  async (data, { orgId, i18n }) => {
    const report = await ThirdPartyService.getLedger(orgId, data);

    return ThirdPartyLedgerResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_THIRD_PARTY_LEDGER_RETRIEVED"),
      data: report,
    });
  },
);
