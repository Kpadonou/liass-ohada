import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SalesInvoiceReceivable } from '@liass-ohada/shared/sales';

import { environment } from '../../../../environments/environment';
import { SalesPaymentsApi } from './sales-payments.api';

describe('SalesPaymentsApi', () => {
  let api: SalesPaymentsApi;
  let http: HttpTestingController;
  const baseUrl = `${environment.apiBaseUrl.replace(/\/$/, '')}/sales/invoices/INV%2F1`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SalesPaymentsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('gets and validates the canonical Receivable, including synthetic version zero', async () => {
    const promise = api.getReceivable('INV/1');
    const request = http.expectOne(`${baseUrl}/receivable`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: receivable() });
    await expect(promise).resolves.toEqual(receivable());
  });

  it('lists immutable Payments with an untouched opaque cursor', async () => {
    const promise = api.listPayments('INV/1', { limit: 25, cursor: 'opaque+/=' });
    const request = http.expectOne((candidate) => candidate.url === `${baseUrl}/payments`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('cursor')).toBe('opaque+/=');
    expect(request.request.params.get('limit')).toBe('25');
    request.flush({ data: { items: [], nextCursor: 'next-opaque' } });
    await expect(promise).resolves.toEqual({ items: [], nextCursor: 'next-opaque' });
  });

  it('records only shared client-owned fields and validates the authoritative response', async () => {
    const payload = {
      expectedVersion: 0,
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      amount: '10.50', paymentDate: '2026-09-10', method: 'BANK_TRANSFER' as const,
      reference: 'BANK-42'
    };
    const promise = api.recordPayment('INV/1', payload);
    const request = http.expectOne(`${baseUrl}/payments`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    expect(request.request.body).not.toHaveProperty('orgId');
    expect(request.request.body).not.toHaveProperty('currency');
    expect(request.request.body).not.toHaveProperty('recordedByUserId');
    const paid = receivable({ amountPaid: '10.50', creditedAmount: '0', balanceDue: '24.89', status: 'PARTIALLY_SETTLED', paymentCount: 1, version: 1 });
    request.flush({ data: { payment: { id: 'PAY-1', invoiceId: 'INV/1', amount: '10.50', currency: 'EUR', paymentDate: '2026-09-10', method: 'BANK_TRANSFER', reference: 'BANK-42', createdAt: '2026-09-10T10:00:00.000Z' }, receivable: paid }, message: 'Recorded' });
    await expect(promise).resolves.toMatchObject({ data: { receivable: paid }, message: 'Recorded' });
  });

  it('rejects forbidden client-owned settlement fields before sending', async () => {
    await expect(api.recordPayment('INV-1', {
      expectedVersion: 0,
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      amount: '10', paymentDate: '2026-09-10', method: 'CASH', currency: 'EUR'
    } as never)).rejects.toBeDefined();
  });
});

function receivable(overrides: Partial<SalesInvoiceReceivable> = {}): SalesInvoiceReceivable {
  return {
    invoiceId: 'INV/1', currency: 'EUR', invoiceAmount: '35.39', amountPaid: '0',
    creditedAmount: '0', balanceDue: '35.39', status: 'OPEN', paymentCount: 0, version: 0,
    updatedAt: '2026-09-10T10:00:00.000Z', ...overrides
  };
}
