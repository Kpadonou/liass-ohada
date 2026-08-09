import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  GetAccountRequestSchema,
  UpdateAccountRequestSchema,
  padAccountId,
} from "@liass-ohada/shared/accounting";
import { z } from "zod";

const UpdateAccountRouteRequestSchema = z.intersection(
  GetAccountRequestSchema,
  UpdateAccountRequestSchema,
);

export const handler = createHandler(
  UpdateAccountRouteRequestSchema,
  async (data, { orgId, i18n }) => {
    const accountId = padAccountId(data.accountId);
    const { accountId: _accountId, ...updates } = data;
    const account = await LedgerService.updateAccount(orgId, accountId, updates);

    return {
      message: i18n.getMessage("SUCCESS_ACCOUNT_UPDATED"),
      account: LedgerService.toAccountDto(account),
    };
  },
  {
    action: "PUT /accounts/{accountId}",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
