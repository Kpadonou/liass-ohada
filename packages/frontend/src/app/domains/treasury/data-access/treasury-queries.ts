import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { TreasuryApi } from './treasury.api';

@Injectable({ providedIn: 'root' })
export class TreasuryQueries {
  private readonly treasuryApi = inject(TreasuryApi);

  listAccounts() {
    return queryOptions({
      queryKey: ['treasury', 'accounts'] as const,
      queryFn: () => this.treasuryApi.listAccounts(),
      staleTime: 60_000
    });
  }

  listMovements(treasuryAccountId: string, year: string) {
    return queryOptions({
      queryKey: ['treasury', 'movements', treasuryAccountId, year] as const,
      queryFn: () => this.treasuryApi.listMovements(treasuryAccountId, year),
      enabled: treasuryAccountId.length > 0 && /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }

  listStatementLines(treasuryAccountId: string, year: string) {
    return queryOptions({
      queryKey: ['treasury', 'statement-lines', treasuryAccountId, year] as const,
      queryFn: () => this.treasuryApi.listStatementLines(treasuryAccountId, year),
      enabled: treasuryAccountId.length > 0 && /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }

  getSummary(year: string) {
    return queryOptions({
      queryKey: ['treasury', 'summary', year] as const,
      queryFn: () => this.treasuryApi.getSummary(year),
      enabled: /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }
}
