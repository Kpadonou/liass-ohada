import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import type { ListSalesInvoicesRequest } from '@liass-ohada/shared/sales';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesInvoicesApi } from './sales-invoices.api';

const NO_TENANT_SCOPE = 'no-active-tenant';

export const salesInvoiceQueryKeys = {
  root: (orgId: string) => ['sales', orgId, 'invoices'] as const,
  lists: (orgId: string) => ['sales', orgId, 'invoices', 'list'] as const,
  list: (orgId: string, options: ListSalesInvoicesRequest) =>
    ['sales', orgId, 'invoices', 'list', { cursor: options.cursor ?? null, limit: options.limit ?? 50 }] as const,
  detail: (orgId: string, invoiceId: string) => ['sales', orgId, 'invoices', invoiceId] as const
};

@Injectable({ providedIn: 'root' })
export class SalesInvoicesQueries {
  private readonly api = inject(SalesInvoicesApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string { return this.authStore.effectiveOrgId() || NO_TENANT_SCOPE; }
  rootKey() { return salesInvoiceQueryKeys.root(this.tenantScope()); }
  listRootKey() { return salesInvoiceQueryKeys.lists(this.tenantScope()); }
  detailKey(invoiceId: string) { return salesInvoiceQueryKeys.detail(this.tenantScope(), invoiceId); }

  list(options: ListSalesInvoicesRequest, enabled = true) {
    return queryOptions({
      queryKey: salesInvoiceQueryKeys.list(this.tenantScope(), options),
      queryFn: () => this.api.list(options),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE,
      staleTime: 30_000
    });
  }

  detail(invoiceId: string, enabled = true) {
    return queryOptions({
      queryKey: this.detailKey(invoiceId),
      queryFn: () => this.api.get(invoiceId),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE && invoiceId.trim().length > 0,
      staleTime: 15_000
    });
  }
}
