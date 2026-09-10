import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import type { ListSalesPaymentsRequest } from '@liass-ohada/shared/sales';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesPaymentsApi } from './sales-payments.api';

const NO_TENANT_SCOPE = 'no-active-tenant';

export const salesPaymentQueryKeys = {
  receivable: (orgId: string, invoiceId: string) =>
    ['sales', orgId, 'invoices', invoiceId, 'receivable'] as const,
  paymentsRoot: (orgId: string, invoiceId: string) =>
    ['sales', orgId, 'invoices', invoiceId, 'payments'] as const,
  payments: (orgId: string, invoiceId: string, options: ListSalesPaymentsRequest) =>
    [
      'sales', orgId, 'invoices', invoiceId, 'payments',
      { cursor: options.cursor ?? null, limit: options.limit ?? 50 }
    ] as const
};

@Injectable({ providedIn: 'root' })
export class SalesPaymentsQueries {
  private readonly api = inject(SalesPaymentsApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string { return this.authStore.effectiveOrgId() || NO_TENANT_SCOPE; }
  receivableKey(invoiceId: string) { return salesPaymentQueryKeys.receivable(this.tenantScope(), invoiceId); }
  paymentsRootKey(invoiceId: string) { return salesPaymentQueryKeys.paymentsRoot(this.tenantScope(), invoiceId); }

  receivable(invoiceId: string, enabled = true) {
    return queryOptions({
      queryKey: this.receivableKey(invoiceId),
      queryFn: () => this.api.getReceivable(invoiceId),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE && invoiceId.trim().length > 0,
      staleTime: 10_000,
      retry: false
    });
  }

  payments(invoiceId: string, options: ListSalesPaymentsRequest, enabled = true) {
    return queryOptions({
      queryKey: salesPaymentQueryKeys.payments(this.tenantScope(), invoiceId, options),
      queryFn: () => this.api.listPayments(invoiceId, options),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE && invoiceId.trim().length > 0,
      staleTime: 10_000,
      retry: false
    });
  }
}
