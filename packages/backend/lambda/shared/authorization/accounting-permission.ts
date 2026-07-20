export const ACCOUNTING_PERMISSIONS = [
  "ACCOUNTING_READ",
  "ACCOUNTING_WRITE",
] as const;

export type AccountingPermission = (typeof ACCOUNTING_PERMISSIONS)[number];

export function isAccountingPermission(
  value: unknown,
): value is AccountingPermission {
  return (
    typeof value === "string" &&
    ACCOUNTING_PERMISSIONS.includes(value as AccountingPermission)
  );
}
