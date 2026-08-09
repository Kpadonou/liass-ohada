import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/domains/treasury/services/treasury-service";
import { CreateReconciliationRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  CreateReconciliationRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const match = await TreasuryService.reconcile(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_RECONCILIATION_CREATED"),
      data: match,
    };
  },
  { permission: "TREASURY_WRITE" },
);
