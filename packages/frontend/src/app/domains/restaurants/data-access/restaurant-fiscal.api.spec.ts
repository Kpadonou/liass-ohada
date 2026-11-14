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
});
