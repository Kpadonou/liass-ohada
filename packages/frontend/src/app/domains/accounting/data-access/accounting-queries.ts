import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AccountingApi, type ListEntriesParams } from './accounting.api';

@Injectable({ providedIn: 'root' })
export class AccountingQueries {
  private readonly accountingApi = inject(AccountingApi);

  listAccounts() {
    return queryOptions({
      queryKey: ['accounting', 'accounts'] as const,
      queryFn: () => this.accountingApi.listAccounts({ limit: 200 }),
      staleTime: 60_000
    });
  }

  listJournals() {
    return queryOptions({
      queryKey: ['accounting', 'journals'] as const,
      queryFn: () => this.accountingApi.listJournals(),
      staleTime: 60_000
    });
  }

  listEntries(params: ListEntriesParams) {
    return queryOptions({
      queryKey: ['accounting', 'entries', params] as const,
      queryFn: () => this.accountingApi.listEntries(params),
      staleTime: 30_000
    });
  }

  generalLedger(params: { fiscalYear: string; accountId: string }) {
    return queryOptions({
      queryKey: ['accounting', 'general-ledger', params] as const,
      queryFn: () => this.accountingApi.getGeneralLedger(params),
      enabled: /^\d{4}$/.test(params.fiscalYear) && /^\d{2,8}$/.test(params.accountId),
      staleTime: 30_000
    });
  }

  trialBalance(year: string) {
    return queryOptions({
      queryKey: ['accounting', 'trial-balance', year] as const,
      queryFn: () => this.accountingApi.getTrialBalance(year),
      enabled: /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }
}
