import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../identity/data-access/auth.store';
import {
  type ListReconciliationMatchesParams,
  type ListStatementLinesParams,
  type ListTreasuryAccountsParams,
  TreasuryApi
} from './treasury.api';

const NO_TENANT_SCOPE = 'no-active-tenant';
const TREASURY_ACCOUNT_PAGE_SIZE = 100;
const STATEMENT_LINE_PAGE_SIZE = 100;
const RECONCILIATION_PAGE_SIZE = 100;

export const treasuryQueryKeys = {
  accounts: (tenantScope: string, options: ListTreasuryAccountsParams = { limit: TREASURY_ACCOUNT_PAGE_SIZE }) =>
    ['treasury', tenantScope, 'accounts', normalizeListAccountsParams(options)] as const,
  accountsRoot: (tenantScope: string) => ['treasury', tenantScope, 'accounts'] as const,
  movements: (tenantScope: string, treasuryAccountId: string, year: string) =>
    ['treasury', tenantScope, 'movements', treasuryAccountId, year] as const,
  movementsRoot: (tenantScope: string, treasuryAccountId: string) =>
    ['treasury', tenantScope, 'movements', treasuryAccountId] as const,
  statementLines: (tenantScope: string, treasuryAccountId: string, options: ListStatementLinesParams) =>
    ['treasury', tenantScope, 'statement-lines', treasuryAccountId, normalizeStatementLineParams(options)] as const,
  statementLinesRoot: (tenantScope: string, treasuryAccountId: string) =>
    ['treasury', tenantScope, 'statement-lines', treasuryAccountId] as const,
  reconciliations: (
    tenantScope: string,
    treasuryAccountId: string,
    options: ListReconciliationMatchesParams
  ) => ['treasury', tenantScope, 'reconciliations', treasuryAccountId, normalizeReconciliationParams(options)] as const,
  reconciliationsRoot: (tenantScope: string, treasuryAccountId: string) =>
    ['treasury', tenantScope, 'reconciliations', treasuryAccountId] as const,
  summary: (tenantScope: string, year: string) =>
    ['treasury', tenantScope, 'summary', year] as const,
  summaryRoot: (tenantScope: string) => ['treasury', tenantScope, 'summary'] as const
};

@Injectable({ providedIn: 'root' })
export class TreasuryQueries {
  private readonly treasuryApi = inject(TreasuryApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string {
    if (this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
      return this.authStore.activeDossierOrgId() || this.authStore.activeWorkspaceOrgId() || NO_TENANT_SCOPE;
    }

    return this.authStore.activeWorkspaceOrgId() || NO_TENANT_SCOPE;
  }

  accountsRootQueryKey() {
    return treasuryQueryKeys.accountsRoot(this.tenantScope());
  }

  summaryRootQueryKey() {
    return treasuryQueryKeys.summaryRoot(this.tenantScope());
  }

  statementLinesRootQueryKey(treasuryAccountId: string) {
    return treasuryQueryKeys.statementLinesRoot(this.tenantScope(), treasuryAccountId);
  }

  movementsRootQueryKey(treasuryAccountId: string) {
    return treasuryQueryKeys.movementsRoot(this.tenantScope(), treasuryAccountId);
  }

  reconciliationsRootQueryKey(treasuryAccountId: string) {
    return treasuryQueryKeys.reconciliationsRoot(this.tenantScope(), treasuryAccountId);
  }

  listAccounts(options: ListTreasuryAccountsParams = { limit: TREASURY_ACCOUNT_PAGE_SIZE }) {
    return queryOptions({
      queryKey: treasuryQueryKeys.accounts(this.tenantScope(), options),
      queryFn: () => this.treasuryApi.listAccounts(options),
      staleTime: 60_000
    });
  }

  listMovements(treasuryAccountId: string, year: string) {
    return queryOptions({
      queryKey: treasuryQueryKeys.movements(this.tenantScope(), treasuryAccountId, year),
      queryFn: () => this.treasuryApi.listMovements(treasuryAccountId, year),
      enabled: treasuryAccountId.length > 0 && /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }

  listStatementLines(
    treasuryAccountId: string,
    options: ListStatementLinesParams = { year: '', limit: STATEMENT_LINE_PAGE_SIZE }
  ) {
    return queryOptions({
      queryKey: treasuryQueryKeys.statementLines(this.tenantScope(), treasuryAccountId, options),
      queryFn: () => this.treasuryApi.listStatementLines(treasuryAccountId, options),
      enabled: treasuryAccountId.length > 0 && /^\d{4}$/.test(options.year),
      staleTime: 30_000
    });
  }

  listReconciliationMatches(
    treasuryAccountId: string,
    options: ListReconciliationMatchesParams = { year: '', limit: RECONCILIATION_PAGE_SIZE }
  ) {
    return queryOptions({
      queryKey: treasuryQueryKeys.reconciliations(this.tenantScope(), treasuryAccountId, options),
      queryFn: () =>
        this.treasuryApi.listReconciliationMatches({
          ...options,
          treasuryAccountId
        }),
      enabled: treasuryAccountId.length > 0 && /^\d{4}$/.test(options.year),
      staleTime: 30_000
    });
  }

  getSummary(year: string) {
    return queryOptions({
      queryKey: treasuryQueryKeys.summary(this.tenantScope(), year),
      queryFn: () => this.treasuryApi.getSummary(year),
      enabled: /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }
}

function normalizeListAccountsParams(options: ListTreasuryAccountsParams) {
  return {
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {})
  };
}

function normalizeStatementLineParams(options: ListStatementLinesParams) {
  return {
    year: options.year,
    limit: options.limit ?? STATEMENT_LINE_PAGE_SIZE,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.direction ? { direction: options.direction } : {}),
    ...(options.startDate ? { startDate: options.startDate } : {}),
    ...(options.endDate ? { endDate: options.endDate } : {})
  };
}

function normalizeReconciliationParams(options: ListReconciliationMatchesParams) {
  return {
    year: options.year,
    limit: options.limit ?? RECONCILIATION_PAGE_SIZE,
    ...(options.status ? { status: options.status } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {})
  };
}
