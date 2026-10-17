import {
  RESTAURANTS_STAFF_SELF_PERMISSIONS,
  RESTAURANTS_PREPARATION_PERMISSIONS,
  RESTAURANTS_SERVICE_PERMISSIONS,
  RESTAURANTS_PERMISSIONS,
  RESTAURANTS_TRANSACTION_PERMISSIONS,
} from "@liass-ohada/shared/shared";
export { RESTAURANTS_PERMISSIONS };
export const ACCOUNTING_PERMISSIONS = [
  "ACCOUNTING_READ",
  "ACCOUNTING_WRITE",
] as const;

export const PROJECTS_PERMISSIONS = [
  "PROJECTS_READ",
  "PROJECTS_WRITE",
] as const;

export const TREASURY_PERMISSIONS = [
  "TREASURY_READ",
  "TREASURY_WRITE",
] as const;

export const SALES_PERMISSIONS = ["SALES_READ", "SALES_WRITE"] as const;

export const ACCOUNTING_PRODUCT_MODULE_PERMISSIONS = [
  ...ACCOUNTING_PERMISSIONS,
  ...PROJECTS_PERMISSIONS,
  ...TREASURY_PERMISSIONS,
] as const;

export const FISCAL_COMPLIANCE_PERMISSIONS = [
  "FISCAL_COMPLIANCE_READ",
  "FISCAL_COMPLIANCE_WRITE",
] as const;

export const DOMAIN_PERMISSIONS = [
  ...ACCOUNTING_PRODUCT_MODULE_PERMISSIONS,
  ...SALES_PERMISSIONS,
  ...RESTAURANTS_PERMISSIONS,
  ...RESTAURANTS_TRANSACTION_PERMISSIONS,
  ...RESTAURANTS_SERVICE_PERMISSIONS,
  ...RESTAURANTS_PREPARATION_PERMISSIONS,
  ...RESTAURANTS_STAFF_SELF_PERMISSIONS,
  ...FISCAL_COMPLIANCE_PERMISSIONS,
] as const;

export type AccountingPermission = (typeof ACCOUNTING_PERMISSIONS)[number];
export type ProjectsPermission = (typeof PROJECTS_PERMISSIONS)[number];
export type TreasuryPermission = (typeof TREASURY_PERMISSIONS)[number];
export type FiscalCompliancePermission =
  (typeof FISCAL_COMPLIANCE_PERMISSIONS)[number];
export type SalesPermission = (typeof SALES_PERMISSIONS)[number];
export type DomainPermission = (typeof DOMAIN_PERMISSIONS)[number];

export function isDomainPermission(value: unknown): value is DomainPermission {
  return (
    typeof value === "string" &&
    DOMAIN_PERMISSIONS.includes(value as DomainPermission)
  );
}

export function isWritePermission(permission: DomainPermission): boolean {
  return permission.endsWith("_WRITE") || permission.endsWith("_MANAGE");
}
