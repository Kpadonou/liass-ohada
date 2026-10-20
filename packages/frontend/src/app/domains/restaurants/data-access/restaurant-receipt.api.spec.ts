import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RestaurantReceiptApi } from './restaurant-receipt.api';
import { AuthStore } from '../../identity/data-access/auth.store';
import { receiptPageFixture, receiptSummary } from './restaurant-receipt.test-fixture';
import { rid } from './restaurants.test-fixture';
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
describe('Receipt API ownership and shared contracts', () => {
  let http: HttpTestingController, api: RestaurantReceiptApi;
  const org = signal('org'),
    user = signal('cashier'),
    revision = signal(1);
  beforeEach(() => {
    org.set('org');
    user.set('cashier');
    revision.set(1);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(RestaurantReceiptApi);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('sends exact publication identity and parses BUILDING without broad reads', async () => {
    const promise = api.publish(ctx, rid(70));
    const call = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith(`/sessions/${ctx.session}/receipt`),
    );
    expect(call.request.body).toEqual({ clientRequestId: rid(70) });
    call.flush({ data: { state: 'BUILDING', receiptId: rid(50), version: 2, partCount: 8 } });
    expect((await promise).state).toBe('BUILDING');
  });
  it('bounded page requests preserve opaque cursor and canonical result', async () => {
    const promise = api.page(ctx, 'opaque-cursor', 8);
    const call = http.expectOne((r) => r.params.get('cursor') === 'opaque-cursor');
    expect(call.request.params.get('limit')).toBe('8');
    call.flush(receiptPageFixture());
    expect((await promise).data).toEqual(receiptSummary());
  });
  it('rejects foreign session response before exposure', async () => {
    const promise = api.page(ctx);
    const rejection = expect(promise).rejects.toThrow('Receipt page mismatch');
    http
      .expectOne((r) => r.method === 'GET')
      .flush({ ...receiptPageFixture(), data: { ...receiptSummary(), guestSessionId: rid(100) } });
    await rejection;
  });
  it.each(['org', 'user', 'revision'])(
    'rejects late response after %s change',
    async (dimension) => {
      const promise = api.page(ctx);
      const rejection = expect(promise).rejects.toMatchObject({ status: 409 });
      const call = http.expectOne((r) => r.method === 'GET');
      if (dimension === 'org') org.set('other');
      if (dimension === 'user') user.set('other');
      if (dimension === 'revision') revision.set(2);
      call.flush(receiptPageFixture());
      await rejection;
    },
  );
  it('rejects unsupported page size without network', async () => {
    await expect(api.page(ctx, undefined, 9)).rejects.toThrow();
    http.expectNone(() => true);
  });
});
