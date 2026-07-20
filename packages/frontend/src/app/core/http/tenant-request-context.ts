import { HttpContext, HttpContextToken } from '@angular/common/http';

export type TenantRequestScope = 'ACCOUNTING' | 'CABINET';
export type AccountingRequestPermission = 'ACCOUNTING_READ' | 'ACCOUNTING_WRITE';

export const TENANT_REQUEST_SCOPE = new HttpContextToken<TenantRequestScope>(
  () => 'ACCOUNTING'
);

export const ACCOUNTING_REQUEST_PERMISSION =
  new HttpContextToken<AccountingRequestPermission>(() => 'ACCOUNTING_READ');

export function accountingWriteContext(): HttpContext {
  return new HttpContext().set(ACCOUNTING_REQUEST_PERMISSION, 'ACCOUNTING_WRITE');
}
