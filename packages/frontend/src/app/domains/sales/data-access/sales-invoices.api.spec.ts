import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SalesDraftInvoice, SalesInvoice } from '@liass-ohada/shared/sales';

import { environment } from '../../../../environments/environment';
import { SalesInvoicesApi } from './sales-invoices.api';

describe('SalesInvoicesApi', () => {
  let api: SalesInvoicesApi;
  let http: HttpTestingController;
  const baseUrl = `${environment.apiBaseUrl.replace(/\/$/, '')}/sales/invoices`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SalesInvoicesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists drafts with an opaque cursor and validates the shared response', async () => {
    const promise = api.list({ limit: 25, cursor: 'opaque+/=' });
    const request = http.expectOne((candidate) => candidate.url === baseUrl);
    expect(request.request.params.get('cursor')).toBe('opaque+/=');
    expect(request.request.params.get('limit')).toBe('25');
    request.flush({ data: { items: [], nextCursor: 'next-opaque' } });
    await expect(promise).resolves.toEqual({ items: [], nextCursor: 'next-opaque' });
  });

  it('creates a lightweight draft without server-owned fields', async () => {
    const promise = api.create({});
    const request = http.expectOne(baseUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ data: invoice(), message: 'Created' });
    await expect(promise).resolves.toMatchObject({ data: { status: 'DRAFT', lineCount: 0 }, message: 'Created' });
  });

  it('uses expectedVersion for header and line mutations without calculated fields', async () => {
    const update = api.update('INV/1', { expectedVersion: 1, customerId: null });
    const headerRequest = http.expectOne(`${baseUrl}/INV%2F1`);
    expect(headerRequest.request.method).toBe('PATCH');
    expect(headerRequest.request.body).toEqual({ expectedVersion: 1, customerId: null });
    headerRequest.flush({ data: invoice({ version: 2 }) });
    await update;

    const add = api.addLine('INV/1', { expectedVersion: 2, description: 'Travel', quantity: '1.5', unitPrice: '19.99', taxRate: '18' });
    const addRequest = http.expectOne(`${baseUrl}/INV%2F1/lines`);
    expect(addRequest.request.body).toEqual({ expectedVersion: 2, description: 'Travel', quantity: '1.5', unitPrice: '19.99', taxRate: '18' });
    addRequest.flush({ data: invoice({ version: 3 }) });
    await add;
  });

  it('updates the exact line route and preserves omitted, null, and replacement unit payloads', async () => {
    for (const payload of [
      { expectedVersion: 3, quantity: '2' },
      { expectedVersion: 3, quantity: '2', unit: null },
      { expectedVersion: 3, quantity: '2', unit: 'day' }
    ] as const) {
      const promise = api.updateLine('INV/1', 'LINE/1', payload);
      const request = http.expectOne(`${baseUrl}/INV%2F1/lines/LINE%2F1`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual(payload);
      request.flush({ data: invoice({ version: 4 }) });
      await promise;
    }
  });

  it('removes a line using the backend query convention', async () => {
    const promise = api.removeLine('INV/1', 'LINE/1', 7);
    const request = http.expectOne((candidate) => candidate.url === `${baseUrl}/INV%2F1/lines/LINE%2F1`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.params.get('expectedVersion')).toBe('7');
    expect(request.request.body).toBeNull();
    request.flush({ data: invoice({ version: 8 }) });
    await promise;
  });

  it('issues through the canonical endpoint with only the shared request fields', async () => {
    const payload = {
      expectedVersion: 7,
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      issueDate: '2026-09-08'
    };
    const promise = api.issueInvoice('INV/1', payload);
    const request = http.expectOne(`${baseUrl}/INV%2F1/issue`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    expect(request.request.body).not.toHaveProperty('invoiceNumber');
    expect(request.request.body).not.toHaveProperty('issuedAt');
    expect(request.request.body).not.toHaveProperty('issuedByUserId');
    request.flush({ data: issuedInvoice(), message: 'Issued' });
    await expect(promise).resolves.toMatchObject({
      data: { status: 'ISSUED', invoiceNumber: '00000042' },
      message: 'Issued'
    });
  });

  it('rejects client-supplied calculated fields through the shared strict schema', async () => {
    await expect(api.addLine('INV-1', {
      expectedVersion: 1, description: 'Line', quantity: '1', unitPrice: '1', total: '1'
    } as never)).rejects.toBeDefined();
  });
});

function invoice(overrides: Partial<SalesDraftInvoice> = {}): SalesDraftInvoice {
  return {
    id: 'INV-1', status: 'DRAFT', currency: 'XOF', subtotal: '0', taxTotal: '0', total: '0',
    lineCount: 0, lines: [], version: 1, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z',
    ...overrides
  };
}

function issuedInvoice(): SalesInvoice {
  return {
    ...invoice({
      lines: [{
        id: 'L-1', position: 1, description: 'Service', quantity: '1', unitPrice: '0', taxRate: '0',
        subtotal: '0', taxAmount: '0', total: '0', createdAt: '2026-09-08T10:00:00.000Z', updatedAt: '2026-09-08T10:00:00.000Z'
      }],
      lineCount: 1,
      version: 2
    }),
    status: 'ISSUED',
    invoiceNumber: '00000042',
    issueDate: '2026-09-08',
    issuedAt: '2026-09-08T10:00:00.000Z'
  };
}
