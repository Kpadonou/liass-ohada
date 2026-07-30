import { Injectable, inject } from '@angular/core';

import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class CabinetSettingsCapabilities {
  private readonly authStore = inject(AuthStore);

  canManageCabinetSettings(): boolean {
    const workspace = this.authStore.activeWorkspace();

    return (
      workspace?.workspaceType === 'ACCOUNTING_FIRM' &&
      workspace.status === 'ACTIVE' &&
      workspace.cabinetRole === 'CABINET_ADMIN'
    );
  }
}
