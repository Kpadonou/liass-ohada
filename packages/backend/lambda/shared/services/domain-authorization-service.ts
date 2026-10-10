import { RestaurantsRoleSchema } from "@liass-ohada/shared/shared";
import type { AccountingAccessMode } from "@liass-ohada/shared";
import {
  ACCOUNTING_PRODUCT_MODULE_PERMISSIONS,
  SALES_PERMISSIONS,
  RESTAURANTS_PERMISSIONS,
  FISCAL_COMPLIANCE_PERMISSIONS,
  isWritePermission,
} from "../authorization/domain-permission";
import type { DomainPermission } from "../authorization/domain-permission";
import { AppError } from "../app-error";

export interface DomainPermissionContext {
  accessMode: AccountingAccessMode;
  permissions?: readonly DomainPermission[];
}

const ACCOUNTING_PRODUCT_READ_PERMISSIONS =
  ACCOUNTING_PRODUCT_MODULE_PERMISSIONS.filter((permission) =>
    permission.endsWith("_READ"),
  );

export class DomainAuthorizationService {
  static permissionsForAccessMode(
    accessMode: AccountingAccessMode,
  ): readonly DomainPermission[] {
    return accessMode === "READ_ONLY"
      ? ACCOUNTING_PRODUCT_READ_PERMISSIONS
      : ACCOUNTING_PRODUCT_MODULE_PERMISSIONS;
  }

  static permissionsForDirectOrganizationRole(
    role: string | undefined,
  ): readonly DomainPermission[] {
    // Only direct COMPANY ownership grants commercial and fiscal capabilities.
    // Cabinet roles and every other/unknown direct role keep their existing grants.
    return role === "OWNER"
      ? [...ACCOUNTING_PRODUCT_MODULE_PERMISSIONS, ...SALES_PERMISSIONS, ...FISCAL_COMPLIANCE_PERMISSIONS]
      : ACCOUNTING_PRODUCT_MODULE_PERMISSIONS;
  }

  /** No global organization, Accounting, Sales or cabinet role implies this assignment. */
  static permissionsForRestaurantsRole(role: unknown): readonly DomainPermission[] {
    const parsed = RestaurantsRoleSchema.safeParse(role);
    if (!parsed.success) return [];
    return parsed.data === "OWNER" || parsed.data === "MANAGER"
      ? RESTAURANTS_PERMISSIONS : ["RESTAURANTS_READ", "RESTAURANTS_MENU_READ"];
  }

  static hasPermission(
    grantedPermissions: readonly DomainPermission[],
    requiredPermission: DomainPermission,
  ): boolean {
    return grantedPermissions.includes(requiredPermission);
  }

  static assertPermission<T extends DomainPermissionContext>(
    context: T,
    requiredPermission: DomainPermission,
  ): T {
    const grantedPermissions =
      context.permissions ?? this.permissionsForAccessMode(context.accessMode);

    if (this.hasPermission(grantedPermissions, requiredPermission)) {
      return context;
    }

    if (
      context.accessMode === "READ_ONLY" &&
      isWritePermission(requiredPermission)
    ) {
      throw new AppError(403, "CABINET_DOSSIER_READ_ONLY");
    }

    throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
  }
}
