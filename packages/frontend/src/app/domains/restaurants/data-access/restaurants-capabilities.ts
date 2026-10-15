import { Injectable, inject } from '@angular/core';
import { restaurantsPermissionsForRole } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../identity/data-access/auth.store';
@Injectable({ providedIn: 'root' })
export class RestaurantsCapabilities {
  private readonly auth = inject(AuthStore);
  private permissions() {
    const workspace = this.auth.activeWorkspace();
    return this.auth.activeWorkspaceType() === 'COMPANY' &&
      this.auth.effectiveOrgId() === workspace?.orgId &&
      (!workspace.accessSource || workspace.accessSource === 'DIRECT')
      ? restaurantsPermissionsForRole(workspace.productRoles?.RESTAURANTS)
      : [];
  }
  // Mirrors LR-TX-1: unassigned staff have no transactional read/write grants.
  canReadService() {
    return this.canManageSetup();
  }
  canOpenSession() {
    return this.canManageSetup();
  }
  canReadStaff() {
    return this.permissions().includes('RESTAURANTS_STAFF_READ');
  }
  canManageStaff() {
    return this.permissions().includes('RESTAURANTS_STAFF_MANAGE');
  }
  canRead() {
    return this.permissions().includes('RESTAURANTS_READ');
  }
  canReadMenu() {
    return this.permissions().includes('RESTAURANTS_MENU_READ');
  }
  canManageSetup() {
    return this.permissions().includes('RESTAURANTS_SETUP_MANAGE');
  }
  canManageMenu() {
    return this.permissions().includes('RESTAURANTS_MENU_MANAGE');
  }
}
