import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/domains/treasury/services/treasury-service";
import { CreateTreasuryTransactionRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  CreateTreasuryTransactionRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await TreasuryService.postTransaction(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_TREASURY_TRANSACTION_POSTED"),
      data: result,
    };
  },
  { permission: "TREASURY_WRITE" },
);
