import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../identity/data-access/auth.store';
import {
  AccountingApi,
  type GeneralLedgerParams,
  type JournalBookParams,
  type ListAccountsParams,
  type ListEntriesParams,
  type MatchingReportParams,
  type ThirdPartyLedgerParams,
  type UnletteredLinesParams
} from './accounting.api';
import { AccountingFiscalYearContextService } from './accounting-fiscal-year-context.service';

const ACCOUNTING_MASTER_DATA_STALE_TIME = 10 * 60_000;
const ACCOUNTING_TRANSACTIONAL_STALE_TIME = 30_000;
const ACCOUNTING_LIVE_MATCHING_STALE_TIME = 15_000;
const NO_TENANT_SCOPE = 'no-active-tenant';

type TenantScope = string;

function normalizeListAccountsParams(options: ListAccountsParams = { limit: 200 }) {
  return {
    cursor: options.cursor ?? null,
    limit: options.limit ?? 200
  };
}

function normalizeListEntriesParams(options: ListEntriesParams) {
  return {
    cursor: options.cursor ?? null,
    journalCode: options.journalCode ?? null,
    limit: options.limit ?? 100,
    month: options.month ?? null,
    status: options.status ?? null,
    year: options.year
  };
}

function normalizeGeneralLedgerParams(params: GeneralLedgerParams) {
  return {
    accountId: params.accountId,
    cursor: params.cursor ?? null,
    fiscalYear: params.fiscalYear,
    limit: params.limit ?? 50
  };
}

function normalizeJournalBookParams(params: JournalBookParams) {
  return {
    cursor: params.cursor ?? null,
    journalCode: params.journalCode.trim().toUpperCase(),
    limit: params.limit ?? 50,
    month: params.month ?? null,
    year: params.year
  };
}

export const accountingQueryKeys = {
  account: (tenantScope: TenantScope, accountId: string) =>
    ['accounting', tenantScope, 'accounts', accountId] as const,
  accounts: (tenantScope: TenantScope, options: ListAccountsParams = { limit: 200 }) =>
    ['accounting', tenantScope, 'accounts', normalizeListAccountsParams(options)] as const,
  accountsRoot: (tenantScope: TenantScope) => ['accounting', tenantScope, 'accounts'] as const,
  entries: (tenantScope: TenantScope, params: ListEntriesParams) =>
    ['accounting', tenantScope, 'entries', normalizeListEntriesParams(params)] as const,
  entryDetail: (tenantScope: TenantScope, year: string, entryId: string) =>
    ['accounting', tenantScope, 'entries', year, entryId] as const,
  fiscalYear: (tenantScope: TenantScope, year: string) =>
    ['accounting', tenantScope, 'fiscal-year', year] as const,
  generalLedger: (tenantScope: TenantScope, params: GeneralLedgerParams) =>
    ['accounting', tenantScope, 'general-ledger', normalizeGeneralLedgerParams(params)] as const,
  incomeStatement: (tenantScope: TenantScope, year: string) =>
    ['accounting', tenantScope, 'income-statement', year] as const,
  journal: (tenantScope: TenantScope, journalCode: string) =>
    ['accounting', tenantScope, 'journals', journalCode] as const,
  journals: (tenantScope: TenantScope) => ['accounting', tenantScope, 'journals'] as const,
  journalBook: (tenantScope: TenantScope, params: JournalBookParams) =>
    ['accounting', tenantScope, 'journal-book', normalizeJournalBookParams(params)] as const,
  matchingReport: (tenantScope: TenantScope, params: MatchingReportParams) =>
    ['accounting', tenantScope, 'matching-report', params] as const,
  thirdPartyLedger: (tenantScope: TenantScope, params: ThirdPartyLedgerParams) =>
    ['accounting', tenantScope, 'third-party-ledger', params] as const,
  trialBalance: (tenantScope: TenantScope, year: string) =>
    ['accounting', tenantScope, 'trial-balance', year] as const,
  unletteredLines: (tenantScope: TenantScope, params: UnletteredLinesParams) =>
    ['accounting', tenantScope, 'unlettered-lines', params] as const
};

@Injectable({ providedIn: 'root' })
export class AccountingQueries {
  private readonly accountingApi = inject(AccountingApi);
  private readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly authStore = inject(AuthStore);

  tenantScope(): TenantScope {
    if (this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
      return this.authStore.activeDossierOrgId() || this.authStore.activeWorkspaceOrgId() || NO_TENANT_SCOPE;
    }

    return this.authStore.activeWorkspaceOrgId() || NO_TENANT_SCOPE;
  }

  accountsQueryKey(options: ListAccountsParams = { limit: 200 }) {
    return accountingQueryKeys.accounts(this.tenantScope(), options);
  }

  accountsRootQueryKey() {
    return accountingQueryKeys.accountsRoot(this.tenantScope());
  }

  journalsQueryKey() {
    return accountingQueryKeys.journals(this.tenantScope());
  }

  listAccounts(options: ListAccountsParams = { limit: 200 }) {
    return queryOptions({
      queryKey: this.accountsQueryKey(options),
      queryFn: () => this.accountingApi.listAccounts(options),
      staleTime: ACCOUNTING_MASTER_DATA_STALE_TIME
    });
  }

  account(accountId: string) {
    return queryOptions({
      queryKey: accountingQueryKeys.account(this.tenantScope(), accountId),
      queryFn: () => this.accountingApi.getAccount(accountId),
      enabled: /^\d{1,8}$/.test(accountId),
      staleTime: ACCOUNTING_MASTER_DATA_STALE_TIME
    });
  }

  listJournals() {
    return queryOptions({
      queryKey: this.journalsQueryKey(),
      queryFn: () => this.accountingApi.listJournals(),
      staleTime: ACCOUNTING_MASTER_DATA_STALE_TIME
    });
  }

  journal(journalCode: string) {
    const code = journalCode.trim();

    return queryOptions({
      queryKey: accountingQueryKeys.journal(this.tenantScope(), code),
      queryFn: () => this.accountingApi.getJournal(code),
      enabled: code.length > 0 && code.length <= 10,
      staleTime: ACCOUNTING_MASTER_DATA_STALE_TIME
    });
  }

  listEntries(params: ListEntriesParams, enabled = true) {
    return queryOptions({
      queryKey: accountingQueryKeys.entries(this.tenantScope(), params),
      queryFn: () => this.accountingApi.listEntries(params),
      enabled: enabled && /^\d{4}$/.test(params.year),
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  listEntriesForActiveFiscalYear(
    params: Omit<ListEntriesParams, 'year'> = {},
    enabled = true
  ) {
    const activeYear = this.fiscalYearContext.activeYear();
    const year = activeYear ? String(activeYear) : '';

    return this.listEntries(
      {
        ...params,
        year
      },
      enabled && !!activeYear
    );
  }

  entryDetail(entryId: string, year = this.fiscalYearContext.activeYear(), enabled = true) {
    const yearValue = year ? String(year) : '';
    const entryIdValue = entryId.trim();

    return queryOptions({
      queryKey: accountingQueryKeys.entryDetail(this.tenantScope(), yearValue, entryIdValue),
      queryFn: () => this.accountingApi.getEntryDetail(entryIdValue, yearValue),
      enabled: enabled && /^\d{4}$/.test(yearValue) && entryIdValue.length > 0,
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  generalLedger(params: GeneralLedgerParams, enabled = true) {
    return queryOptions({
      queryKey: accountingQueryKeys.generalLedger(this.tenantScope(), params),
      queryFn: () => this.accountingApi.getGeneralLedger(params),
      enabled: enabled && /^\d{4}$/.test(params.fiscalYear) && /^\d{2,8}$/.test(params.accountId),
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  generalLedgerForActiveFiscalYear(
    params: Omit<GeneralLedgerParams, 'fiscalYear'>,
    enabled = true
  ) {
    const activeYear = this.fiscalYearContext.activeYear();

    return this.generalLedger(
      {
        ...params,
        fiscalYear: activeYear ? String(activeYear) : ''
      },
      enabled && !!activeYear
    );
  }

  trialBalance(year: string, enabled = true) {
    return queryOptions({
      queryKey: accountingQueryKeys.trialBalance(this.tenantScope(), year),
      queryFn: () => this.accountingApi.getTrialBalance(year),
      enabled: enabled && /^\d{4}$/.test(year),
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  trialBalanceForActiveFiscalYear(enabled = true) {
    const activeYear = this.fiscalYearContext.activeYear();

    return this.trialBalance(
      activeYear ? String(activeYear) : '',
      enabled && !!activeYear
    );
  }

  journalBook(params: JournalBookParams, enabled = true) {
    const normalizedJournalCode = params.journalCode.trim().toUpperCase();
    const normalizedParams = {
      ...params,
      journalCode: normalizedJournalCode
    };

    return queryOptions({
      queryKey: accountingQueryKeys.journalBook(this.tenantScope(), normalizedParams),
      queryFn: () => this.accountingApi.getJournalBook(normalizedParams),
      enabled:
        enabled &&
        /^\d{4}$/.test(params.year) &&
        normalizedJournalCode.length > 0 &&
        normalizedJournalCode.length <= 10,
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  journalBookForActiveFiscalYear(
    params: Omit<JournalBookParams, 'year'>,
    enabled = true
  ) {
    const activeYear = this.fiscalYearContext.activeYear();

    return this.journalBook(
      {
        ...params,
        year: activeYear ? String(activeYear) : ''
      },
      enabled && !!activeYear
    );
  }

  fiscalYearDetails(year: string | number, enabled = true) {
    const yearValue = String(year);

    return queryOptions({
      queryKey: accountingQueryKeys.fiscalYear(this.tenantScope(), yearValue),
      queryFn: () => this.accountingApi.getFiscalYearDetails(yearValue),
      enabled: enabled && /^\d{4}$/.test(yearValue),
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  incomeStatement(year: string | number) {
    const yearValue = String(year);

    return queryOptions({
      queryKey: accountingQueryKeys.incomeStatement(this.tenantScope(), yearValue),
      queryFn: () => this.accountingApi.getIncomeStatement(yearValue),
      enabled: /^\d{4}$/.test(yearValue),
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  thirdPartyLedger(params: ThirdPartyLedgerParams, enabled = true) {
    return queryOptions({
      queryKey: accountingQueryKeys.thirdPartyLedger(this.tenantScope(), params),
      queryFn: () => this.accountingApi.getThirdPartyLedger(params),
      enabled: enabled && /^\d{2,8}$/.test(params.accountId) && !!params.thirdPartyId,
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  matchingReport(params: MatchingReportParams, enabled = true) {
    return queryOptions({
      queryKey: accountingQueryKeys.matchingReport(this.tenantScope(), params),
      queryFn: () => this.accountingApi.getMatchingReport(params),
      enabled: enabled && /^\d{2,8}$/.test(params.accountId) && !!params.thirdPartyId,
      staleTime: ACCOUNTING_TRANSACTIONAL_STALE_TIME
    });
  }

  unletteredLines(params: UnletteredLinesParams, enabled = true) {
    return queryOptions({
      queryKey: accountingQueryKeys.unletteredLines(this.tenantScope(), params),
      queryFn: () => this.accountingApi.getUnletteredLines(params),
      enabled: enabled && /^\d{2,8}$/.test(params.accountId) && !!params.thirdPartyId,
      staleTime: ACCOUNTING_LIVE_MATCHING_STALE_TIME
    });
  }
}
