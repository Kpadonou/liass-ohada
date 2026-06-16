import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  GetAccountRequestSchema,
  padAccountId,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  GetAccountRequestSchema,
  async (data, { orgId, i18n }) => {
    const accountId = padAccountId(data.accountId);
    const account = await LedgerService.disableAccount(orgId, accountId);

    return {
      message: i18n.getMessage("SUCCESS_ACCOUNT_DISABLED"),
      account: LedgerService.toAccountDto(account),
    };
  },
);
