import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { SalesCreditNotesApi } from './sales-credit-notes.api';

describe('SalesCreditNotesApi', () => {
  let api: SalesCreditNotesApi;
  let http: HttpTestingController;
  const baseUrl = `${environment.apiBaseUrl.replace(/\/$/, '')}/sales/invoices/INV%2F1/credit-notes`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SalesCreditNotesApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lists invoice-scoped credit notes with an opaque cursor', async () => {
    const promise = api.list('INV/1', { limit: 25, cursor: 'opaque+/=' });
    const request = http.expectOne((candidate) => candidate.url === baseUrl);
    expect(request.request.params.get('cursor')).toBe('opaque+/=');
    request.flush({ data: { items: [] } });
    await expect(promise).resolves.toEqual({ items: [] });
  });

  it('creates a draft without sending tenant or source snapshot facts', async () => {
    const promise = api.create('INV/1', { reason: 'Returned goods' });
    const request = http.expectOne(baseUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reason: 'Returned goods' });
    expect(request.request.body).not.toHaveProperty('orgId');
    expect(request.request.body).not.toHaveProperty('currency');
    request.flush({ data: draft(), message: 'Created' });
    await expect(promise).resolves.toMatchObject({ data: { id: 'CN-1' }, message: 'Created' });
  });

  it('uses exact update, line and issue routes with contract-owned payloads', async () => {
    const update = api.update('INV/1', 'CN/1', { expectedVersion: 1, reason: 'Reduction' });
    let request = http.expectOne(`${baseUrl}/CN%2F1`);
    expect(request.request.method).toBe('PATCH');
    request.flush({ data: draft({ version: 2, reason: 'Reduction' }) });
    await update;

    const add = api.addLine('INV/1', 'CN/1', { expectedVersion: 2, originalInvoiceLineId: 'L-1', quantity: '1.25' });
    request = http.expectOne(`${baseUrl}/CN%2F1/lines`);
    expect(request.request.body).toEqual({ expectedVersion: 2, originalInvoiceLineId: 'L-1', quantity: '1.25' });
    request.flush({ data: draft({ version: 3 }) });
    await add;

    const remove = api.removeLine('INV/1', 'CN/1', 'LINE/1', 3);
    request = http.expectOne((candidate) => candidate.url === `${baseUrl}/CN%2F1/lines/LINE%2F1`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.params.get('expectedVersion')).toBe('3');
    request.flush({ data: draft({ version: 4 }) });
    await remove;

    const payload = { expectedCreditNoteVersion: 4, expectedReceivableVersion: 0, clientRequestId: '00000000-0000-4000-8000-000000000001', issueDate: '2026-09-11' };
    const issue = api.issue('INV/1', 'CN/1', payload);
    request = http.expectOne(`${baseUrl}/CN%2F1/issue`);
    expect(request.request.body).toEqual(payload);
    request.flush({ data: { creditNote: issued(), receivable: receivable() } });
    await expect(issue).resolves.toMatchObject({ data: { creditNote: { status: 'ISSUED' }, receivable: { creditedAmount: '10' } } });
  });

  it('gets and generates the canonical credit-note PDF without sending business or storage data', async () => {
    const document = creditNoteDocument();
    const getPromise = api.getDocument('INV/1', 'CN/1');
    let request = http.expectOne(`${baseUrl}/CN%2F1/documents/pdf`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: document });
    await expect(getPromise).resolves.toEqual(document);

    const generatePromise = api.generateDocument('INV/1', 'CN/1');
    request = http.expectOne(`${baseUrl}/CN%2F1/documents/pdf`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    expect(request.request.body).not.toHaveProperty('objectKey');
    expect(request.request.body).not.toHaveProperty('bucket');
    expect(request.request.body).not.toHaveProperty('creditNote');
    expect(request.request.body).not.toHaveProperty('invoice');
    request.flush({ data: document, message: 'Ready' });
    await expect(generatePromise).resolves.toEqual({ data: document, message: 'Ready' });
  });

  it('requests a fresh backend-issued download URL from the exact document route', async () => {
    const promise = api.createDocumentDownloadUrl('INV/1', 'CN/1');
    const request = http.expectOne(`${baseUrl}/CN%2F1/documents/pdf/download-url`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ data: { url: 'https://documents.example.test/opaque', expiresAt: '2026-09-16T11:05:00.000Z' } });
    await expect(promise).resolves.toEqual({
      url: 'https://documents.example.test/opaque', expiresAt: '2026-09-16T11:05:00.000Z'
    });
  });
});

function draft(overrides: Record<string, unknown> = {}) {
  return { id: 'CN-1', originalInvoiceId: 'INV/1', originalInvoiceNumber: '42', currency: 'EUR', status: 'DRAFT', lines: [], subtotal: '0', taxTotal: '0', total: '0', lineCount: 0, version: 1, createdAt: '2026-09-11T10:00:00.000Z', updatedAt: '2026-09-11T10:00:00.000Z', ...overrides };
}
function issued() { return { ...draft(), status: 'ISSUED', reason: 'Reduction', creditNoteNumber: '7', issueDate: '2026-09-11', issuedAt: '2026-09-11T11:00:00.000Z', lines: [{ id: 'CL-1', originalInvoiceLineId: 'L-1', position: 1, description: 'Service', quantity: '1', unitPrice: '10', taxRate: '0', subtotal: '10', taxAmount: '0', total: '10', createdAt: '2026-09-11T10:00:00.000Z', updatedAt: '2026-09-11T10:00:00.000Z' }], subtotal: '10', total: '10', lineCount: 1, version: 5 }; }
function receivable() { return { invoiceId: 'INV/1', currency: 'EUR', invoiceAmount: '35.39', amountPaid: '0', creditedAmount: '10', balanceDue: '25.39', status: 'PARTIALLY_SETTLED', paymentCount: 0, version: 1, updatedAt: '2026-09-11T11:00:00.000Z' }; }
function creditNoteDocument() {
  return {
    status: 'AVAILABLE', creditNoteId: 'CN/1', documentType: 'CREDIT_NOTE_PDF', renderingVersion: '1',
    contentHash: 'a'.repeat(64), contentType: 'application/pdf', sizeBytes: 2048,
    generatedAt: '2026-09-16T11:00:00.000Z'
  };
}
