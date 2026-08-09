import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/domains/treasury/services/treasury-service";
import { CreateTreasuryAccountRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  CreateTreasuryAccountRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const account = await TreasuryService.createAccount(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_TREASURY_ACCOUNT_CREATED"),
      data: account,
    };
  },
  { permission: "TREASURY_WRITE" },
);
