import { TestBed } from '@angular/core/testing';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesPaymentsApi } from './sales-payments.api';
import { SalesPaymentsQueries, salesPaymentQueryKeys } from './sales-payments.queries';

describe('SalesPaymentsQueries', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [
    { provide: AuthStore, useValue: { effectiveOrgId: () => 'org-effective' } },
    { provide: SalesPaymentsApi, useValue: { getReceivable: () => Promise.resolve(), listPayments: () => Promise.resolve() } }
  ] }));

  it('scopes Receivable and Payment keys to effectiveOrgId and invoiceId', () => {
    const queries = TestBed.inject(SalesPaymentsQueries);
    expect(queries.receivableKey('INV-1')).toEqual(['sales', 'org-effective', 'invoices', 'INV-1', 'receivable']);
    expect(queries.paymentsRootKey('INV-1')).toEqual(['sales', 'org-effective', 'invoices', 'INV-1', 'payments']);
    expect(queries.payments('INV-1', { limit: 25, cursor: 'opaque+/=' }).queryKey).toEqual([
      'sales', 'org-effective', 'invoices', 'INV-1', 'payments', { cursor: 'opaque+/=', limit: 25 }
    ]);
  });

  it('cannot share Receivable or cursor cache entries across tenants or invoices', () => {
    expect(salesPaymentQueryKeys.receivable('org-a', 'INV-1')).not.toEqual(salesPaymentQueryKeys.receivable('org-b', 'INV-1'));
    expect(salesPaymentQueryKeys.payments('org-a', 'INV-1', { cursor: 'same' })).not.toEqual(salesPaymentQueryKeys.payments('org-a', 'INV-2', { cursor: 'same' }));
  });

  it('disables both server queries when the caller is not eligible', () => {
    const queries = TestBed.inject(SalesPaymentsQueries);
    expect(queries.receivable('INV-1', false).enabled).toBe(false);
    expect(queries.payments('INV-1', {}, false).enabled).toBe(false);
  });
});
