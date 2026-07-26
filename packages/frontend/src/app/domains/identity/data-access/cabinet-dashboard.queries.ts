import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from './auth.store';
import { CabinetDashboardApi } from './cabinet-dashboard.api';

const NO_CABINET = 'no-active-cabinet';
const STALE_TIME = 20_000;

export const cabinetDashboardQueryKeys = {
  all: (cabinetOrgId: string) => ['cabinet-dashboard', cabinetOrgId] as const,
  detail: (cabinetOrgId: string) => ['cabinet-dashboard', cabinetOrgId, 'detail'] as const
};

@Injectable({ providedIn: 'root' })
export class CabinetDashboardQueries {
  private readonly api = inject(CabinetDashboardApi);
  private readonly authStore = inject(AuthStore);

  scope(): string {
    return this.authStore.activeWorkspaceOrgId() ?? NO_CABINET;
  }

  all() {
    return cabinetDashboardQueryKeys.all(this.scope());
  }

  detailKey() {
    return cabinetDashboardQueryKeys.detail(this.scope());
  }

  detail() {
    return queryOptions({
      queryKey: this.detailKey(),
      queryFn: () => this.api.getCabinetDashboard(),
      enabled: this.dashboardEnabled(),
      staleTime: STALE_TIME
    });
  }

  private dashboardEnabled(): boolean {
    return (
      this.authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM' &&
      !!this.authStore.activeWorkspaceOrgId() &&
      this.authStore.activeCabinetRole() !== null
    );
  }
}
