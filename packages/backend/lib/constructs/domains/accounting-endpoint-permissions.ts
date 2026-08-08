import type { AccountingPermission } from "../../../lambda/shared/authorization/accounting-permission";

export const ACCOUNTING_ENDPOINT_PERMISSIONS = {
  "accounts/create-account": "ACCOUNTING_WRITE",
  "accounts/list-accounts": "ACCOUNTING_READ",
  "accounts/get-account": "ACCOUNTING_READ",
  "accounts/update-account": "ACCOUNTING_WRITE",
  "accounts/disable-account": "ACCOUNTING_WRITE",
  "accounts/get-balance": "ACCOUNTING_READ",
  "accounts/get-entries": "ACCOUNTING_READ",
  "third-parties/create-third-party": "ACCOUNTING_WRITE",
  "third-parties/list-third-parties": "ACCOUNTING_READ",
  "third-parties/get-third-party": "ACCOUNTING_READ",
  "third-parties/update-third-party": "ACCOUNTING_WRITE",
  "third-parties/activate-third-party": "ACCOUNTING_WRITE",
  "third-parties/deactivate-third-party": "ACCOUNTING_WRITE",
  "entries/post-entry": "ACCOUNTING_WRITE",
  "entries/list-entries": "ACCOUNTING_READ",
  "entries/create-draft": "ACCOUNTING_WRITE",
  "entries/get-entry": "ACCOUNTING_READ",
  "entries/update-draft": "ACCOUNTING_WRITE",
  "entries/delete-draft": "ACCOUNTING_WRITE",
  "entries/post-draft": "ACCOUNTING_WRITE",
  "books/get-general-ledger": "ACCOUNTING_READ",
  "books/get-trial-balance": "ACCOUNTING_READ",
  "books/get-journal-book": "ACCOUNTING_READ",
  "books/get-third-party-ledger": "ACCOUNTING_READ",
  "books/get-third-party-balance": "ACCOUNTING_READ",
  "books/get-matching-report": "ACCOUNTING_READ",
  "reports/get-income-statement": "ACCOUNTING_READ",
  "reports/get-summary": "ACCOUNTING_READ",
  "fiscal-year/create-fiscal-year": "ACCOUNTING_WRITE",
  "fiscal-year/get-details": "ACCOUNTING_READ",
  "fiscal-year/get-closing-checks": "ACCOUNTING_READ",
  "fiscal-year/close-fiscal-year": "ACCOUNTING_WRITE",
  "fiscal-year/close-period": "ACCOUNTING_WRITE",
  "fiscal-year/lock-period": "ACCOUNTING_WRITE",
  "fiscal-year/unlock-period": "ACCOUNTING_WRITE",
  "lettering/get-candidates": "ACCOUNTING_READ",
  "lettering/create-match": "ACCOUNTING_WRITE",
  "lettering/get-match": "ACCOUNTING_READ",
  "lettering/cancel-match": "ACCOUNTING_WRITE",
  "lettering/post-lettering": "ACCOUNTING_WRITE",
  "lettering/cancel-lettering": "ACCOUNTING_WRITE",
  "lettering/get-unlettered-lines": "ACCOUNTING_READ",
  "journals/create-journal": "ACCOUNTING_WRITE",
  "journals/list-journals": "ACCOUNTING_READ",
  "journals/get-journal": "ACCOUNTING_READ",
  "journals/get-journal-entries": "ACCOUNTING_READ",
  "journals/update-journal": "ACCOUNTING_WRITE",
  "journals/delete-journal": "ACCOUNTING_WRITE",
} as const satisfies Record<string, AccountingPermission>;

export function requireEndpointPermission(
  registry: Readonly<Record<string, AccountingPermission>>,
  handlerPath: string,
): AccountingPermission {
  const permission = registry[handlerPath];
  if (!permission) {
    throw new Error(`Accounting permission missing for endpoint: ${handlerPath}`);
  }
  return permission;
}
