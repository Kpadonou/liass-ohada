import { Injectable, inject } from '@angular/core';

import { AuthStore } from '../../identity/data-access/auth.store';

/** Mirrors the effective-organization permission projection enforced by the backend. */
@Injectable({ providedIn: 'root' })
export class SalesCapabilities {
  private readonly authStore = inject(AuthStore);

  canRead(): boolean {
    if (!this.authStore.effectiveOrgId()) return false;
    return (
      this.authStore.activeWorkspaceType() === 'COMPANY' &&
      this.authStore.activeWorkspace()?.role === 'OWNER'
    );
  }

  canWrite(): boolean {
    return this.canRead();
  }
}
