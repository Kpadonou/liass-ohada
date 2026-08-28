import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import type { ListSalesCustomersRequest } from '@liass-ohada/shared/sales';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesCustomersApi } from './sales-customers.api';

const NO_TENANT_SCOPE = 'no-active-tenant';
const SALES_CUSTOMERS_STALE_TIME = 60_000;

export const salesCustomerQueryKeys = {
  root: (orgId: string) => ['sales', orgId, 'customers'] as const,
  list: (orgId: string, options: ListSalesCustomersRequest) =>
    ['sales', orgId, 'customers', { cursor: options.cursor ?? null, limit: options.limit ?? 50 }] as const,
  detail: (orgId: string, customerId: string) => ['sales', orgId, 'customers', customerId] as const
};

@Injectable({ providedIn: 'root' })
export class SalesCustomersQueries {
  private readonly api = inject(SalesCustomersApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string { return this.authStore.effectiveOrgId() || NO_TENANT_SCOPE; }
  rootKey() { return salesCustomerQueryKeys.root(this.tenantScope()); }
  detailKey(customerId: string) { return salesCustomerQueryKeys.detail(this.tenantScope(), customerId); }

  list(options: ListSalesCustomersRequest, enabled = true) {
    return queryOptions({
      queryKey: salesCustomerQueryKeys.list(this.tenantScope(), options),
      queryFn: () => this.api.list(options),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE,
      staleTime: SALES_CUSTOMERS_STALE_TIME
    });
  }

  detail(customerId: string, enabled = true) {
    return queryOptions({
      queryKey: this.detailKey(customerId),
      queryFn: () => this.api.get(customerId),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE && customerId.trim().length > 0,
      staleTime: SALES_CUSTOMERS_STALE_TIME
    });
  }
}
