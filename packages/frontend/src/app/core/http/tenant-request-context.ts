import { HttpContextToken } from '@angular/common/http';

export type TenantRequestScope = 'ACCOUNTING' | 'CABINET';

export const TENANT_REQUEST_SCOPE = new HttpContextToken<TenantRequestScope>(
  () => 'ACCOUNTING'
);

