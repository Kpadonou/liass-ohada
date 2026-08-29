import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import type { ListSalesCatalogItemsRequest } from '@liass-ohada/shared/sales';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesItemsApi } from './sales-items.api';

const NO_TENANT_SCOPE = 'no-active-tenant';
const SALES_ITEMS_STALE_TIME = 60_000;

export const salesItemQueryKeys = {
  root: (orgId: string) => ['sales', orgId, 'items'] as const,
  list: (orgId: string, options: ListSalesCatalogItemsRequest) =>
    ['sales', orgId, 'items', { cursor: options.cursor ?? null, limit: options.limit ?? 50 }] as const,
  detail: (orgId: string, itemId: string) => ['sales', orgId, 'items', itemId] as const
};

@Injectable({ providedIn: 'root' })
export class SalesItemsQueries {
  private readonly api = inject(SalesItemsApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string { return this.authStore.effectiveOrgId() || NO_TENANT_SCOPE; }
  rootKey() { return salesItemQueryKeys.root(this.tenantScope()); }
  detailKey(itemId: string) { return salesItemQueryKeys.detail(this.tenantScope(), itemId); }

  list(options: ListSalesCatalogItemsRequest, enabled = true) {
    return queryOptions({
      queryKey: salesItemQueryKeys.list(this.tenantScope(), options),
      queryFn: () => this.api.list(options),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE,
      staleTime: SALES_ITEMS_STALE_TIME
    });
  }

  detail(itemId: string, enabled = true) {
    return queryOptions({
      queryKey: this.detailKey(itemId),
      queryFn: () => this.api.get(itemId),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE && itemId.trim().length > 0,
      staleTime: SALES_ITEMS_STALE_TIME
    });
  }
}
