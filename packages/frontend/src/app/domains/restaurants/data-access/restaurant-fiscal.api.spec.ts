import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RestaurantFiscalApi } from './restaurant-fiscal.api';
import { RestaurantOrdersApi } from './restaurant-orders.api';
import { rid } from './restaurants.test-fixture';
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
describe('Fiscal result transport', () => {
  const context = { assertContext: vi.fn() };
  beforeEach(() => {
    context.assertContext.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RestaurantOrdersApi, useValue: context },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });
  it('reads only the scoped result and validates the invoice identity', async () => {
    const promise = TestBed.inject(RestaurantFiscalApi).result(ctx, rid(3));
    const request = TestBed.inject(HttpTestingController).expectOne((r) =>
      r.url.endsWith(`/invoices/${rid(3)}/fiscal/result`),
    );
    expect(request.request.method).toBe('GET');
    request.flush({
      invoiceId: rid(3),
      environment: 'TEST',
      execution: 'REAL_TEST',
      status: 'UNKNOWN_OUTCOME',
      confirmed: false,
      legallyNormalized: false,
      normalizedInvoice: null,
      securityElements: null,
      total: 2360,
      uncertainOperation: 'CONFIRM',
      mutationRetryAllowed: false,
      resultAvailable: false,
      evidenceOrigin: null,
    });
    expect(await promise).toMatchObject({ status: 'UNKNOWN_OUTCOME', securityElements: null });
    expect(context.assertContext).toHaveBeenCalledTimes(2);
  });
  it('reads a linked credit result through the existing invoice fiscal route', async () => {
    const promise = TestBed.inject(RestaurantFiscalApi).creditResult(ctx, rid(3), rid(4));
    const request = TestBed.inject(HttpTestingController).expectOne((r) =>
      r.url.endsWith(`/invoices/${rid(3)}/fiscal/result`) && r.params.get('creditNoteId') === rid(4));
    request.flush({ invoiceId: rid(3), creditNoteId: rid(4), originalFiscalReference: 'A'.repeat(24),
      environment: 'TEST', execution: 'REAL_TEST', status: 'CONFIRMED', confirmed: true,
      legallyNormalized: false, normalizedInvoice: null, total: 554, uncertainOperation: null,
      mutationRetryAllowed: false, resultAvailable: true, evidenceOrigin: 'DGI_TEST',
      securityElements: { dateTime: '15/11/2026 10:00:00', qrCode: 'qr',
        codeMECeFDGI: 'C'.repeat(24), counters: '2/2 FA', nim: 'NIM' } });
    expect(await promise).toMatchObject({ creditNoteId: rid(4), originalFiscalReference: 'A'.repeat(24) });
  });
  it('uses the existing durable invoice CREATE and CONFIRM routes', async () => {
    const api = TestBed.inject(RestaurantFiscalApi);
    const createPromise = api.initiate(ctx, rid(3), rid(5), rid(6));
    const create = TestBed.inject(HttpTestingController).expectOne((r) =>
      r.url.endsWith(`/invoices/${rid(3)}/fiscal`) && r.method === 'POST');
    expect(create.request.body).toEqual({ attemptId: rid(5), commandId: rid(6) });
    create.flush({ invoiceId: rid(3), environment: 'TEST', execution: 'REAL_TEST',
      status: 'CREATED', confirmed: false, legallyNormalized: false, normalizedInvoice: null,
      securityElements: null, total: 2360, mutationRetryAllowed: false, uncertainOperation: null });
    await expect(createPromise).resolves.toMatchObject({ status: 'CREATED' });

    const confirmPromise = api.confirm(ctx, rid(3), rid(7));
    const confirm = TestBed.inject(HttpTestingController).expectOne((r) =>
      r.url.endsWith(`/invoices/${rid(3)}/fiscal/confirm`) && r.method === 'PUT');
    expect(confirm.request.body).toEqual({ commandId: rid(7), confirm: true });
    confirm.flush({ invoiceId: rid(3), environment: 'TEST', execution: 'REAL_TEST',
      status: 'CONFIRMED', confirmed: true, legallyNormalized: false, normalizedInvoice: null,
      securityElements: { dateTime: '15/11/2026 10:00:00', qrCode: 'qr',
        codeMECeFDGI: 'C'.repeat(24), counters: '1/1 FV', nim: 'NIM' }, total: 2360,
      uncertainOperation: null, mutationRetryAllowed: false, resultAvailable: true,
      evidenceOrigin: 'DGI_TEST' });
    await expect(confirmPromise).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
});
