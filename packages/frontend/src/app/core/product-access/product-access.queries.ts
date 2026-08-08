import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { ProductAccessApi } from './product-access.api';

const NO_ACTIVE_ORGANIZATION = 'no-active-organization';
export const PRODUCT_ACCESS_STALE_TIME = 5 * 60_000;

export const productAccessQueryKeys = {
  list: (orgId: string) => ['product-access', orgId] as const,
};

@Injectable({ providedIn: 'root' })
export class ProductAccessQueries {
  private readonly api = inject(ProductAccessApi);
  private readonly authStore = inject(AuthStore);

  activeOrgId(): string | null {
    return this.authStore.effectiveAccountingOrgId();
  }

  list() {
    const orgId = this.activeOrgId();

    return queryOptions({
      queryKey: productAccessQueryKeys.list(orgId ?? NO_ACTIVE_ORGANIZATION),
      queryFn: () => {
        if (!orgId) {
          throw new Error('An active organization is required to load ProductAccess.');
        }

        return this.api.listProductAccess(orgId);
      },
      enabled:
        this.authStore.isAuthenticated() && this.authStore.workspacesLoaded() && orgId !== null,
      staleTime: PRODUCT_ACCESS_STALE_TIME,
    });
  }
}
