import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import {
  AccountingApi,
  type ListAccountsParams,
  type ListEntriesParams,
  type MatchingReportParams,
  type ThirdPartyLedgerParams,
  type UnletteredLinesParams
} from './accounting.api';

export const accountingQueryKeys = {
  account: (accountId: string) => ['accounting', 'accounts', accountId] as const,
  accounts: ['accounting', 'accounts'] as const,
  entries: (params: ListEntriesParams) => ['accounting', 'entries', params] as const,
  fiscalYear: (year: string) => ['accounting', 'fiscal-year', year] as const,
  generalLedger: (params: { fiscalYear: string; accountId: string }) =>
    ['accounting', 'general-ledger', params] as const,
  incomeStatement: (year: string) => ['accounting', 'income-statement', year] as const,
  journals: ['accounting', 'journals'] as const,
  matchingReport: (params: MatchingReportParams) =>
    ['accounting', 'matching-report', params] as const,
  thirdPartyLedger: (params: ThirdPartyLedgerParams) =>
    ['accounting', 'third-party-ledger', params] as const,
  trialBalance: (year: string) => ['accounting', 'trial-balance', year] as const,
  unletteredLines: (params: UnletteredLinesParams) =>
    ['accounting', 'unlettered-lines', params] as const
};

@Injectable({ providedIn: 'root' })
export class AccountingQueries {
  private readonly accountingApi = inject(AccountingApi);

  listAccounts(options: ListAccountsParams = { limit: 200 }) {
    return queryOptions({
      queryKey: accountingQueryKeys.accounts,
      queryFn: () => this.accountingApi.listAccounts(options),
      staleTime: 60_000
    });
  }

  account(accountId: string) {
    return queryOptions({
      queryKey: accountingQueryKeys.account(accountId),
      queryFn: () => this.accountingApi.getAccount(accountId),
      enabled: /^\d{1,8}$/.test(accountId),
      staleTime: 60_000
    });
  }

  listJournals() {
    return queryOptions({
      queryKey: accountingQueryKeys.journals,
      queryFn: () => this.accountingApi.listJournals(),
      staleTime: 60_000
    });
  }

  listEntries(params: ListEntriesParams) {
    return queryOptions({
      queryKey: accountingQueryKeys.entries(params),
      queryFn: () => this.accountingApi.listEntries(params),
      staleTime: 30_000
    });
  }

  generalLedger(params: { fiscalYear: string; accountId: string }) {
    return queryOptions({
      queryKey: accountingQueryKeys.generalLedger(params),
      queryFn: () => this.accountingApi.getGeneralLedger(params),
      enabled: /^\d{4}$/.test(params.fiscalYear) && /^\d{2,8}$/.test(params.accountId),
      staleTime: 30_000
    });
  }

  trialBalance(year: string) {
    return queryOptions({
      queryKey: accountingQueryKeys.trialBalance(year),
      queryFn: () => this.accountingApi.getTrialBalance(year),
      enabled: /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }

  fiscalYearDetails(year: string | number) {
    const yearValue = String(year);

    return queryOptions({
      queryKey: accountingQueryKeys.fiscalYear(yearValue),
      queryFn: () => this.accountingApi.getFiscalYearDetails(yearValue),
      enabled: /^\d{4}$/.test(yearValue),
      staleTime: 30_000
    });
  }

  incomeStatement(year: string | number) {
    const yearValue = String(year);

    return queryOptions({
      queryKey: accountingQueryKeys.incomeStatement(yearValue),
      queryFn: () => this.accountingApi.getIncomeStatement(yearValue),
      enabled: /^\d{4}$/.test(yearValue),
      staleTime: 30_000
    });
  }

  thirdPartyLedger(params: ThirdPartyLedgerParams) {
    return queryOptions({
      queryKey: accountingQueryKeys.thirdPartyLedger(params),
      queryFn: () => this.accountingApi.getThirdPartyLedger(params),
      enabled: /^\d{2,8}$/.test(params.accountId) && !!params.thirdPartyId,
      staleTime: 30_000
    });
  }

  matchingReport(params: MatchingReportParams) {
    return queryOptions({
      queryKey: accountingQueryKeys.matchingReport(params),
      queryFn: () => this.accountingApi.getMatchingReport(params),
      enabled: /^\d{2,8}$/.test(params.accountId) && !!params.thirdPartyId,
      staleTime: 30_000
    });
  }

  unletteredLines(params: UnletteredLinesParams) {
    return queryOptions({
      queryKey: accountingQueryKeys.unletteredLines(params),
      queryFn: () => this.accountingApi.getUnletteredLines(params),
      enabled: /^\d{2,8}$/.test(params.accountId) && !!params.thirdPartyId,
      staleTime: 15_000
    });
  }
}
