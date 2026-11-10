import { Injectable, inject } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { ProductAccess } from '@liass-ohada/shared/shared';

import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { RestaurantsCapabilities } from '../../../domains/restaurants/data-access/restaurants-capabilities';
import { SalesCapabilities } from '../../../domains/sales/data-access/sales-capabilities';
import { ProductAccessQueries } from '../../product-access/product-access.queries';
import { resolveProductAvailability } from '../../product-access/product-availability';
import { welcomeApplicationCatalog } from './welcome-applications';

@Injectable({ providedIn: 'root' })
export class WelcomeDestination {
  private readonly auth = inject(AuthStore);
  private readonly queries = inject(ProductAccessQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly sales = inject(SalesCapabilities);
  private readonly restaurants = inject(RestaurantsCapabilities);

  accessibleApplications(access: readonly ProductAccess[]): typeof welcomeApplicationCatalog[number][] {
    return welcomeApplicationCatalog.filter((application) => {
      if (resolveProductAvailability(access, application.code, true) !== 'AVAILABLE') return false;
      if (application.code === 'SALES') return this.sales.canRead();
      if (application.code === 'RESTAURANTS') return this.restaurants.canRead();
      return this.auth.canReadAccounting();
    });
  }

  async resolve(): Promise<string> {
    const workspace = this.auth.activeWorkspace();
    if (!workspace || workspace.orgId !== this.auth.effectiveOrgId() || workspace.status !== 'ACTIVE') {
      return this.auth.workspaceDestination() ?? '/select-workspace';
    }
    if (workspace.workspaceType === 'ACCOUNTING_FIRM') return '/cabinet/dashboard';
    try {
      const access = await this.queryClient.ensureQueryData(this.queries.list());
      if (this.auth.effectiveOrgId() !== workspace.orgId) return '/select-workspace';
      const applications = this.accessibleApplications(access);
      return applications.length === 1 ? applications[0].openRoute : '/welcome';
    } catch {
      // The welcome page owns the retry and error state for unavailable ProductAccess.
      return '/welcome';
    }
  }
}
