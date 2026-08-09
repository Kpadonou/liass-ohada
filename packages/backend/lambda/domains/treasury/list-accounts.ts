import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/domains/treasury/services/treasury-service";
import { ListTreasuryAccountsRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  ListTreasuryAccountsRequestSchema,
  async (data, { orgId, i18n }) => {
    const result = await TreasuryService.listAccounts(orgId, data);

    return {
      message: i18n.getMessage("SUCCESS_TREASURY_ACCOUNTS_RETRIEVED"),
      data: {
        accounts: result.accounts,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.count,
      },
    };
  },
  {
    action: "GET /treasury/accounts",
    permission: "TREASURY_READ",
    productCode: "ACCOUNTING",
  },
);
