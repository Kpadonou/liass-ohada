import { ACCOUNTING_PERMISSIONS } from "./domain-permission";
import type { AccountingPermission } from "./domain-permission";

export { ACCOUNTING_PERMISSIONS };
export type { AccountingPermission };

export function isAccountingPermission(
  value: unknown,
): value is AccountingPermission {
  return (
    typeof value === "string" &&
    ACCOUNTING_PERMISSIONS.includes(value as AccountingPermission)
  );
}
