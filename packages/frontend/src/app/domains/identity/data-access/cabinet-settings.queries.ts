import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from './auth.store';
import { CabinetSettingsApi } from './cabinet-settings.api';
import { CabinetSettingsCapabilities } from './cabinet-settings-capabilities';

const NO_CABINET = 'no-active-cabinet';
const STALE_TIME = 30_000;

export const cabinetSettingsQueryKeys = {
  all: (cabinetOrgId: string) => ['cabinet-settings', cabinetOrgId] as const,
  detail: (cabinetOrgId: string) => ['cabinet-settings', cabinetOrgId, 'detail'] as const
};

@Injectable({ providedIn: 'root' })
export class CabinetSettingsQueries {
  private readonly api = inject(CabinetSettingsApi);
  private readonly authStore = inject(AuthStore);
  private readonly capabilities = inject(CabinetSettingsCapabilities);

  scope(): string {
    return this.authStore.activeWorkspaceOrgId() ?? NO_CABINET;
  }

  all() {
    return cabinetSettingsQueryKeys.all(this.scope());
  }

  detailKey() {
    return cabinetSettingsQueryKeys.detail(this.scope());
  }

  detail() {
    return queryOptions({
      queryKey: this.detailKey(),
      queryFn: () => this.api.getCabinetSettings(),
      enabled: this.capabilities.canManageCabinetSettings(),
      staleTime: STALE_TIME
    });
  }
}
