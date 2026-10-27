import { Injectable, inject } from '@angular/core';
import {
  restaurantsPermissionsForRole,
  RESTAURANTS_SERVICE_PERMISSIONS,
  RestaurantsRoleSchema,
} from '@liass-ohada/shared/shared';
import { AuthStore } from '../../identity/data-access/auth.store';
import { canAdministerCompanyMembers } from '../../identity/data-access/organization-members.api';
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
  // SVC-2C1 publishes service vocabulary; the server owns the role projection and outlet gate.
  private servicePermissions(): readonly (typeof RESTAURANTS_SERVICE_PERMISSIONS)[number][] {
    return this.canManageSetup() ||
      (this.canRead() &&
        this.auth.activeWorkspace()?.productRoles?.RESTAURANTS ===
          RestaurantsRoleSchema.enum.WAITER)
      ? RESTAURANTS_SERVICE_PERMISSIONS
      : [];
  }
  canReadCheckout() {
    return (
      this.canRead() &&
      (!this.auth.activeWorkspace()?.status || this.auth.activeWorkspace()?.status === 'ACTIVE') &&
      ['OWNER', 'MANAGER', 'CASHIER'].includes(
        this.auth.activeWorkspace()?.productRoles?.RESTAURANTS ?? '',
      )
    );
  }
  canReadReceipt() {
    return this.canReadCheckout();
  }
  canPublishReceipt() {
    return this.canReadReceipt();
  }
  canCapturePayment() {
    return this.canReadCheckout();
  }
  canCloseCheckout() {
    return this.canReadCheckout();
  }
  canReadKitchen() {
    return (
      this.canRead() &&
      ['OWNER', 'MANAGER', 'KITCHEN'].includes(
        this.auth.activeWorkspace()?.productRoles?.RESTAURANTS ?? '',
      )
    );
  }
  usesAssignedOutlets() {
    return this.canReadService() && !this.canManageSetup();
  }
  canReadService() {
    return this.servicePermissions().includes('RESTAURANTS_SERVICE_FLOOR_READ');
  }
  canReadSession() {
    return this.servicePermissions().includes('RESTAURANTS_SERVICE_SESSION_READ');
  }
  canOpenSession() {
    return this.servicePermissions().includes('RESTAURANTS_SERVICE_SESSION_OPEN_MANAGE');
  }
  // SVC-2A responsibility management shares the existing OWNER/MANAGER-only transaction boundary.
  canManageResponsibility() {
    return this.canManageSetup();
  }
  canReadStaff() {
    return this.permissions().includes('RESTAURANTS_STAFF_READ');
  }
  canManageStaff() {
    return this.permissions().includes('RESTAURANTS_STAFF_MANAGE');
  }
  canProvisionStaff() {
    return (
      this.canManageStaff() &&
      canAdministerCompanyMembers(
        this.auth.activeWorkspace(),
        this.auth.activeWorkspaceType(),
        this.auth.effectiveOrgId(),
      )
    );
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
  canManageInventory() {
    return this.canManageSetup();
  }
  canManageMenu() {
    return this.permissions().includes('RESTAURANTS_MENU_MANAGE');
  }
}
