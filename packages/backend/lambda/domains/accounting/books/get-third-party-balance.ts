import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  ThirdPartyBalanceQuerySchema,
  ThirdPartyBalanceResponseSchema,
} from "@liass-ohada/shared/accounting";

/**
 * @description Retrieves auxiliary account balances grouped by third party.
 * Uses tenant-scoped third-party listing plus bounded GSI2 ledger queries.
 */
export const handler = createHandler(
  ThirdPartyBalanceQuerySchema,
  async (data, { orgId, i18n }) => {
    const balance = await ThirdPartyService.getBalance(orgId, data);

    return ThirdPartyBalanceResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_THIRD_PARTY_BALANCE_RETRIEVED"),
      data: balance,
    });
  },
  {
    action: "GET /books/third-party-balance",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
