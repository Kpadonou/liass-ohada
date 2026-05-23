import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  GetAccountRequestSchema,
  padAccountId,
} from "@liass-ohada/shared/core-ledger";

/**
 * Retrieves the details of a specific accounting account.
 * Looks up account by ID within the organization's chart of accounts.
 * @param accountId - The account ID to retrieve (will be padded to 8 digits)
 * @returns The account details and success message
 */
export const handler = createHandler(
  GetAccountRequestSchema,
  async (data, { orgId, i18n }) => {
    const accountId = padAccountId(data.accountId);
    const account = await LedgerService.getAccount(orgId, accountId);

    return {
      message: i18n.getMessage("SUCCESS_ACCOUNT_RETRIEVED"),
      account,
    };
  },
);
