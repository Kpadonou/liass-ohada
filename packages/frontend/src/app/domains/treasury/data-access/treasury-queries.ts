import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../identity/data-access/auth.store';
import { type ListTreasuryAccountsParams, TreasuryApi } from './treasury.api';

const NO_TENANT_SCOPE = 'no-active-tenant';
const TREASURY_ACCOUNT_PAGE_SIZE = 100;

export const treasuryQueryKeys = {
  accounts: (tenantScope: string, options: ListTreasuryAccountsParams = { limit: TREASURY_ACCOUNT_PAGE_SIZE }) =>
    ['treasury', tenantScope, 'accounts', normalizeListAccountsParams(options)] as const,
  accountsRoot: (tenantScope: string) => ['treasury', tenantScope, 'accounts'] as const,
  movements: (tenantScope: string, treasuryAccountId: string, year: string) =>
    ['treasury', tenantScope, 'movements', treasuryAccountId, year] as const,
  statementLines: (tenantScope: string, treasuryAccountId: string, year: string) =>
    ['treasury', tenantScope, 'statement-lines', treasuryAccountId, year] as const,
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

  listStatementLines(treasuryAccountId: string, year: string) {
    return queryOptions({
      queryKey: treasuryQueryKeys.statementLines(this.tenantScope(), treasuryAccountId, year),
      queryFn: () => this.treasuryApi.listStatementLines(treasuryAccountId, year),
      enabled: treasuryAccountId.length > 0 && /^\d{4}$/.test(year),
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
