/**
 * @description Handler to retrieve the pre-aggregated balance for a specific account.
 */
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import {
  AccountBalanceQuerySchema,
  AccountBalanceResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  AccountBalanceQuerySchema,
  async (data, { orgId, i18n }) => {
    const { fiscalYear, accountId } = data;

    // Utilisation de la méthode statique de la classe BalanceService
    const balance = await BalanceService.getAccountBalance(
      orgId,
      fiscalYear,
      accountId,
    );

    return AccountBalanceResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_BALANCE_RETRIEVED"),
      data: BalanceService.toDto(balance),
    });
  },
);
