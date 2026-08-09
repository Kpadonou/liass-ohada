import { KeyFactory } from "@/lambda/shared/key-builder";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  AccountSchema,
  CreateAccountRequestSchema,
  padAccountId,
} from "@liass-ohada/shared/accounting";
import { defaultAuxiliaryMetadata } from "@/lambda/shared/account-auxiliary";

/**
 * Slim handler: create account in chart of accounts.
 * The middleware handles parsing, validation and i18n error mapping.
 */
export const handler = createHandler(
  CreateAccountRequestSchema,
  async (data, { orgId, i18n }) => {
    const accountId = padAccountId(data.accountId);
    await LedgerService.assertAccountNotExists(orgId, accountId);

    const now = new Date().toISOString();
    const auxiliaryMetadata =
      data.requiresThirdParty !== undefined && data.auxiliaryType !== undefined
        ? {
            requiresThirdParty: data.requiresThirdParty,
            auxiliaryType: data.auxiliaryType,
          }
        : defaultAuxiliaryMetadata(accountId, data.isThirdPartyAccount);
    const account = {
      ...data,
      ...auxiliaryMetadata,
      isThirdPartyAccount: auxiliaryMetadata.auxiliaryType !== "NONE",
      orgId,
      accountId,
      entityType: "ACCOUNT",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK(accountId),
      createdAt: now,
      updatedAt: now,
    };

    const validAccount = AccountSchema.parse(account);

    await LedgerService.createAccount(validAccount);

    return {
      message: i18n.getMessage("SUCCESS_ACCOUNT_CREATED"),
      account: LedgerService.toAccountDto(validAccount),
    };
  },
  {
    action: "POST /accounts",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
