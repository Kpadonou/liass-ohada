import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import {
  AccountBalance,
  BalanceService,
} from "@/lambda/shared/services/balance-service";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  TrialBalanceLineDto,
  TrialBalanceQuerySchema,
  TrialBalanceResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  TrialBalanceQuerySchema,
  async (data, { orgId, i18n }) => {
    const fiscalYear = await LedgerService.getFiscalYear(orgId, data.year);

    if (
      data.startDate < fiscalYear.startDate ||
      data.endDate > fiscalYear.endDate
    ) {
      throw new AppError(400, "ERROR_TRIAL_BALANCE_DATE_OUTSIDE_FISCAL_YEAR");
    }

    const balances = await BalanceService.getTrialBalance(orgId, data.year);
    const isFullFiscalYear =
      data.startDate === fiscalYear.startDate &&
      data.endDate === fiscalYear.endDate;

    if (!isFullFiscalYear) {
      balances.forEach(BalanceService.assertPeriodDetailComplete);
    }

    const filteredBalances = balances.filter((balance) =>
      matchesAccountFilters(balance.accountId, data),
    );
    const accountLabels = await BalanceService.getAccountLabels(
      orgId,
      filteredBalances.map((balance) => balance.accountId),
    );

    const rows = filteredBalances
      .map((balance) =>
        toTrialBalanceRow(
          balance,
          accountLabels.get(balance.accountId) ??
            i18n.getMessage("TRIAL_BALANCE_ACCOUNT_LABEL_UNAVAILABLE", {
              accountId: balance.accountId,
            }).message,
          data.startDate,
          data.endDate,
          isFullFiscalYear,
        ),
      )
      .filter((row) => !data.hideZeroMovement || hasBalanceActivity(row))
      .sort((left, right) => left.accountCode.localeCompare(right.accountCode));

    const totals = rows.reduce(
      (result, row) => ({
        openingDebit: result.openingDebit + row.openingDebit,
        openingCredit: result.openingCredit + row.openingCredit,
        movementDebit: result.movementDebit + row.movementDebit,
        movementCredit: result.movementCredit + row.movementCredit,
        closingDebit: result.closingDebit + row.closingDebit,
        closingCredit: result.closingCredit + row.closingCredit,
      }),
      {
        openingDebit: 0,
        openingCredit: 0,
        movementDebit: 0,
        movementCredit: 0,
        closingDebit: 0,
        closingCredit: 0,
      },
    );
    const movementDifference = totals.movementDebit - totals.movementCredit;
    const closingDifference = totals.closingDebit - totals.closingCredit;

    return TrialBalanceResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_TRIAL_BALANCE_RETRIEVED"),
      data: {
        rows,
        totals: {
          ...totals,
          isMovementBalanced: movementDifference === 0,
          isClosingBalanced: closingDifference === 0,
          movementDifference,
          closingDifference,
        },
        period: {
          fiscalYear: data.year,
          startDate: data.startDate,
          endDate: data.endDate,
        },
      },
    });
  },
);

function toTrialBalanceRow(
  balance: AccountBalance,
  accountLabel: string,
  startDate: string,
  endDate: string,
  isFullFiscalYear: boolean,
): TrialBalanceLineDto {
  let openingNet = balance.openingDebit - balance.openingCredit;
  let movementDebit = 0;
  let movementCredit = 0;

  if (isFullFiscalYear) {
    movementDebit = balance.movementDebit;
    movementCredit = balance.movementCredit;
  } else {
    for (const [date, movement] of Object.entries(balance.dailyMovements)) {
      if (date < startDate) {
        openingNet += movement.debit - movement.credit;
      } else if (date <= endDate) {
        movementDebit += movement.debit;
        movementCredit += movement.credit;
      }
    }
  }

  const periodNet = movementDebit - movementCredit;
  const closingNet = openingNet + periodNet;

  return {
    accountCode: balance.accountId,
    accountLabel,
    openingDebit: Math.max(openingNet, 0),
    openingCredit: Math.max(-openingNet, 0),
    movementDebit,
    movementCredit,
    closingDebit: Math.max(closingNet, 0),
    closingCredit: Math.max(-closingNet, 0),
  };
}

function matchesAccountFilters(
  accountCode: string,
  filters: {
    accountPrefix?: string;
    accountFrom?: string;
    accountTo?: string;
    accountClass?: number;
  },
): boolean {
  if (filters.accountPrefix && !accountCode.startsWith(filters.accountPrefix)) {
    return false;
  }

  if (
    filters.accountClass &&
    !accountCode.startsWith(String(filters.accountClass))
  ) {
    return false;
  }

  if (
    filters.accountFrom &&
    accountCode < filters.accountFrom.padEnd(8, "0")
  ) {
    return false;
  }

  if (filters.accountTo && accountCode > filters.accountTo.padEnd(8, "9")) {
    return false;
  }

  return true;
}

function hasBalanceActivity(row: TrialBalanceLineDto): boolean {
  return (
    row.openingDebit !== 0 ||
    row.openingCredit !== 0 ||
    row.movementDebit !== 0 ||
    row.movementCredit !== 0 ||
    row.closingDebit !== 0 ||
    row.closingCredit !== 0
  );
}
