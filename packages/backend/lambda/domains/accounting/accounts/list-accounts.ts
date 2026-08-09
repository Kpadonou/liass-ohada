import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { ListAccountsRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  ListAccountsRequestSchema,
  async (data, { orgId, i18n }) => {
    const result = await LedgerService.listAccounts(orgId, {
      limit: data.limit,
      cursor: data.cursor,
      search: data.search,
      classCode: data.class,
      active: data.active,
      activeOnly: data.activeOnly,
    });

    return {
      message: i18n.getMessage("SUCCESS_ACCOUNTS_RETRIEVED"),
      data: {
        ...result,
        items: result.accounts,
      },
    };
  },
  {
    action: "GET /accounts",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
