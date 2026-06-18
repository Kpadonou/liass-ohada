import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import {
  TrialBalanceLineDto,
  TrialBalanceQuerySchema,
  TrialBalanceResponseSchema,
} from "@liass-ohada/shared/accounting";

/**
 * @description Slim handler for 6-column Trial Balance (Balance à 6 colonnes).
 * This implementation uses pre-aggregated account balances from ACCOUNT_BALANCE records.
 * Each row includes:
 * - openingDebit / openingCredit (RAN values)
 * - movementDebit / movementCredit (post-RAN journal movements)
 * - finalDebit / finalCredit (net result)
 *
 * Grand totals are computed for the full list.
 */
export const handler = createHandler(
  TrialBalanceQuerySchema,
  async (data, { orgId, i18n }) => {
    const balances = await BalanceService.getTrialBalance(orgId, data.year);

    const rows: TrialBalanceLineDto[] = balances
      .map((item) => {
        const openingDebit = item.openingDebit;
        const openingCredit = item.openingCredit;
        const movementDebit = item.movementDebit;
        const movementCredit = item.movementCredit;

        const finalNet =
          openingDebit + movementDebit - (openingCredit + movementCredit);
        const finalDebit = finalNet > 0 ? finalNet : 0;
        const finalCredit = finalNet < 0 ? Math.abs(finalNet) : 0;

        return {
          accountId: item.accountId,
          openingDebit,
          openingCredit,
          movementDebit,
          movementCredit,
          finalDebit,
          finalCredit,
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    const grandTotals = rows.reduce(
      (acc, row) => {
        acc.openingDebit += row.openingDebit;
        acc.openingCredit += row.openingCredit;
        acc.movementDebit += row.movementDebit;
        acc.movementCredit += row.movementCredit;
        acc.finalDebit += row.finalDebit;
        acc.finalCredit += row.finalCredit;
        return acc;
      },
      {
        openingDebit: 0,
        openingCredit: 0,
        movementDebit: 0,
        movementCredit: 0,
        finalDebit: 0,
        finalCredit: 0,
      },
    );

    return TrialBalanceResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_TRIAL_BALANCE_RETRIEVED"),
      data: {
        rows,
        totals: grandTotals,
      },
    });
  },
);
