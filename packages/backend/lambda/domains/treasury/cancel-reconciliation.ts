import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/domains/treasury/services/treasury-service";
import { CancelReconciliationRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  CancelReconciliationRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const match = await TreasuryService.cancelReconciliation(
      orgId,
      data.treasuryAccountId,
      data.year,
      data.matchId,
      userId,
      data.cancelReason,
    );

    return {
      message: i18n.getMessage("SUCCESS_RECONCILIATION_CANCELLED"),
      data: match,
    };
  },
  {
    action: "POST /treasury/reconciliations/{matchId}/cancel",
    permission: "TREASURY_WRITE",
    productCode: "ACCOUNTING",
  },
);
