import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  AccountDto,
  SummaryReportDto,
  SummaryReportDtoSchema,
  SummaryReportQuery,
} from "@liass-ohada/shared/accounting";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../middleware/handler-wrapper";
import { AccountBalance, BalanceService } from "./balance-service";
import { ClosingService } from "./closing-service";
import { LedgerService } from "./ledger-service";
import { ThirdPartyService } from "./third-party-service";

interface PeriodBalance {
  openingDebit: number;
  openingCredit: number;
  movementDebit: number;
  movementCredit: number;
}

interface AuxiliaryTotals {
  accountIds: string[];
  totalDebit: number;
  totalCredit: number;
  totalBalanceDebit: number;
  totalBalanceCredit: number;
  unletteredAmount: number;
  thirdPartyCount: number;
}

export class SimplifiedReportingService {
  static async getSummaryReport(
    orgId: string,
    query: SummaryReportQuery,
  ): Promise<SummaryReportDto> {
    const fiscalYear = await LedgerService.getFiscalYear(orgId, query.fiscalYear);
    const startDate = query.startDate ?? fiscalYear.startDate;
    const endDate = query.endDate ?? fiscalYear.endDate;

    if (startDate < fiscalYear.startDate || endDate > fiscalYear.endDate) {
      throw new AppError(400, "ERROR_TRIAL_BALANCE_DATE_OUTSIDE_FISCAL_YEAR");
    }

    const balances = await BalanceService.getTrialBalance(
      orgId,
      query.fiscalYear,
    );
    const isFullFiscalYear =
      startDate === fiscalYear.startDate && endDate === fiscalYear.endDate;

    if (!isFullFiscalYear) {
      balances.forEach(BalanceService.assertPeriodDetailComplete);
    }

    const [movementCount, auxiliary, closingChecks] = await Promise.all([
      SimplifiedReportingService.countPostedEntries(orgId, {
        fiscalYear: query.fiscalYear,
        startDate,
        endDate,
      }),
      query.includeAuxiliary
        ? SimplifiedReportingService.getAuxiliarySummary(orgId, {
            fiscalYear: query.fiscalYear,
            startDate,
            endDate,
          })
        : Promise.resolve(undefined),
      query.includeClosingChecks
        ? ClosingService.runClosingChecks(orgId, query.fiscalYear, {
            allowClosedFiscalYear: true,
          })
        : Promise.resolve(undefined),
    ]);

    const trialBalance = SimplifiedReportingService.buildTrialBalanceSummary(
      balances,
      startDate,
      endDate,
      isFullFiscalYear,
      movementCount,
    );
    const income = SimplifiedReportingService.buildIncomeSummary(
      balances,
      startDate,
      endDate,
      isFullFiscalYear,
    );

    return SummaryReportDtoSchema.parse({
      period: {
        fiscalYear: query.fiscalYear,
        startDate,
        endDate,
        generatedAt: new Date().toISOString(),
      },
      trialBalance,
      income,
      auxiliary,
      closingReadiness: closingChecks
        ? {
            canClose: closingChecks.canClose,
            errorsCount: closingChecks.errors.length,
            warningsCount: closingChecks.warnings.length,
            draftEntriesCount: closingChecks.summary.draftEntriesCount,
            unbalancedEntriesCount:
              closingChecks.summary.unbalancedEntriesCount,
            unletteredAuxiliaryLinesCount:
              closingChecks.summary.unletteredAuxiliaryLinesCount,
          }
        : undefined,
    });
  }

  static async getSimplifiedReport(
    orgId: string,
    query: SummaryReportQuery,
  ): Promise<SummaryReportDto> {
    return SimplifiedReportingService.getSummaryReport(orgId, query);
  }

  private static buildTrialBalanceSummary(
    balances: AccountBalance[],
    startDate: string,
    endDate: string,
    isFullFiscalYear: boolean,
    movementCount: number,
  ) {
    const totals = balances.reduce(
      (result, balance) => {
        const period = SimplifiedReportingService.getPeriodBalance(
          balance,
          startDate,
          endDate,
          isFullFiscalYear,
        );

        return {
          totalDebit:
            result.totalDebit + period.openingDebit + period.movementDebit,
          totalCredit:
            result.totalCredit + period.openingCredit + period.movementCredit,
        };
      },
      { totalDebit: 0, totalCredit: 0 },
    );

    return {
      totalDebit: totals.totalDebit,
      totalCredit: totals.totalCredit,
      isBalanced: totals.totalDebit === totals.totalCredit,
      accountCount: balances.length,
      movementCount,
    };
  }

  private static buildIncomeSummary(
    balances: AccountBalance[],
    startDate: string,
    endDate: string,
    isFullFiscalYear: boolean,
  ) {
    const revenueAccounts = [];
    const expenseAccounts = [];
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const balance of balances) {
      if (!balance.accountId.startsWith("6") && !balance.accountId.startsWith("7")) {
        continue;
      }

      const period = SimplifiedReportingService.getPeriodBalance(
        balance,
        startDate,
        endDate,
        isFullFiscalYear,
      );

      if (period.movementDebit === 0 && period.movementCredit === 0) {
        continue;
      }

      if (balance.accountId.startsWith("7")) {
        const netAmount = period.movementCredit - period.movementDebit;
        totalRevenue += netAmount;
        revenueAccounts.push({
          accountId: balance.accountId,
          totalDebit: period.movementDebit,
          totalCredit: period.movementCredit,
          netAmount,
        });
      }

      if (balance.accountId.startsWith("6")) {
        const netAmount = period.movementDebit - period.movementCredit;
        totalExpense += netAmount;
        expenseAccounts.push({
          accountId: balance.accountId,
          totalDebit: period.movementDebit,
          totalCredit: period.movementCredit,
          netAmount,
        });
      }
    }

    return {
      totalRevenue,
      totalExpense,
      netResult: totalRevenue - totalExpense,
      revenueAccounts,
      expenseAccounts,
    };
  }

  private static getPeriodBalance(
    balance: AccountBalance,
    startDate: string,
    endDate: string,
    isFullFiscalYear: boolean,
  ): PeriodBalance {
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

    return {
      openingDebit: openingNet > 0 ? openingNet : 0,
      openingCredit: openingNet < 0 ? Math.abs(openingNet) : 0,
      movementDebit,
      movementCredit,
    };
  }

  private static async countPostedEntries(
    orgId: string,
    period: { fiscalYear: string; startDate: string; endDate: string },
  ): Promise<number> {
    let count = 0;
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI7,
          KeyConditionExpression: "GSI7PK = :pk AND GSI7SK BETWEEN :from AND :to",
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.journalBookPK(orgId, period.fiscalYear),
            ":from": KeyFactory.journalBookSK(period.startDate, ""),
            ":to": KeyFactory.journalBookSK(period.endDate, "\uffff"),
          }),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true,
        }),
      );

      count += result.Items?.length ?? 0;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return count;
  }

  private static async getAuxiliarySummary(
    orgId: string,
    period: { fiscalYear: string; startDate: string; endDate: string },
  ) {
    const auxiliaryAccounts =
      await SimplifiedReportingService.listAuxiliaryAccounts(orgId);
    const customers = await SimplifiedReportingService.getAuxiliaryTotals(
      orgId,
      period,
      auxiliaryAccounts.filter((account) => account.auxiliaryType === "CUSTOMER"),
      "CUSTOMER",
    );
    const suppliers = await SimplifiedReportingService.getAuxiliaryTotals(
      orgId,
      period,
      auxiliaryAccounts.filter((account) => account.auxiliaryType === "SUPPLIER"),
      "SUPPLIER",
    );

    return {
      customers,
      suppliers,
    };
  }

  private static async listAuxiliaryAccounts(
    orgId: string,
  ): Promise<AccountDto[]> {
    const accounts: AccountDto[] = [];
    let cursor: string | undefined;

    do {
      const page = await LedgerService.listAccounts(orgId, {
        classCode: 4,
        activeOnly: true,
        limit: 200,
        cursor,
      });
      accounts.push(
        ...page.accounts.filter(
          (account) =>
            account.requiresThirdParty &&
            (account.auxiliaryType === "CUSTOMER" ||
              account.auxiliaryType === "SUPPLIER"),
        ),
      );
      cursor = page.nextCursor;
    } while (cursor);

    return accounts;
  }

  private static async getAuxiliaryTotals(
    orgId: string,
    period: { fiscalYear: string; startDate: string; endDate: string },
    accounts: AccountDto[],
    thirdPartyType: "CUSTOMER" | "SUPPLIER",
  ): Promise<AuxiliaryTotals> {
    const totals: AuxiliaryTotals = {
      accountIds: accounts.map((account) => account.accountId),
      totalDebit: 0,
      totalCredit: 0,
      totalBalanceDebit: 0,
      totalBalanceCredit: 0,
      unletteredAmount: 0,
      thirdPartyCount: 0,
    };

    for (const account of accounts) {
      let cursor: string | undefined;

      do {
        const balance = await ThirdPartyService.getBalance(orgId, {
          fiscalYear: period.fiscalYear,
          accountId: account.accountId,
          thirdPartyType,
          startDate: period.startDate,
          endDate: period.endDate,
          limit: 200,
          cursor,
        });

        totals.totalDebit += balance.summary.totalMovementDebit;
        totals.totalCredit += balance.summary.totalMovementCredit;
        totals.totalBalanceDebit += balance.summary.totalClosingDebit;
        totals.totalBalanceCredit += balance.summary.totalClosingCredit;
        totals.thirdPartyCount += balance.summary.thirdPartyCount;
        totals.unletteredAmount += balance.rows.reduce(
          (sum, row) => sum + (row.unletteredAmount ?? 0),
          0,
        );
        cursor = balance.nextCursor;
      } while (cursor);
    }

    return totals;
  }
}
