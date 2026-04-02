/**
 * @description Handler to retrieve the pre-aggregated balance for a specific account.
 */
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import { z } from "zod";

const GetAccountBalanceSchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  accountId: z.string().min(2),
});

export const handler = createHandler(
  GetAccountBalanceSchema,
  async (data, { orgId, i18n }) => {
    const { fiscalYear, accountId } = data;

    // Utilisation de la méthode statique de la classe BalanceService
    const balance = await BalanceService.getAccountBalance(
      orgId,
      fiscalYear,
      accountId,
    );

    return {
      message: i18n.getMessage("SUCCESS_BALANCE_RETRIEVED"),
      data: balance,
    };
  },
);
