import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RestaurantGuestApi } from './restaurant-guest.api';
import { RestaurantGuestCartStore } from './restaurant-guest-cart.store';
const token = 'A'.repeat(43);
const context = {
  state: 'FREE',
  visitRef: null,
  restaurantName: 'Bistro',
  outletName: 'Centre',
  tableName: 'Jardin',
  guestHandle: 'a'.repeat(22),
  capability: 'c'.repeat(100),
  policy: 'DIRECT',
  orderingPermitted: true,
  waiterCallAvailable: true,
  expiresAt: new Date(Date.now() + 600000).toISOString(),
} as const;
describe('Guest bounded access recovery', () => {
  let api: RestaurantGuestApi, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(RestaurantGuestApi);
    http = TestBed.inject(HttpTestingController);
    api.configureRecovery(token, 'table-scope');
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });
  const pending = (suffix: string) =>
    vi.waitFor(() => http.expectOne((r) => r.url.endsWith(suffix)));
  it('renews once and retries an expired read without losing Cart', async () => {
    const cart = TestBed.inject(RestaurantGuestCartStore);
    cart.activate('liass-restaurants.guest.' + 'a'.repeat(64), context);
    cart.add(
      {
        reference: 'r'.repeat(43),
        selectionRef: 's'.repeat(200),
        name: 'Poulet',
        amountMinor: 2500,
        availability: 'AVAILABLE',
      },
      'XOF',
      new Date(Date.now() + 900000).toISOString(),
    );
    const before = cart.lines();
    const result = api.submissionState(context.capability);
    (await pending('/state')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush({ ...context, capability: 'n'.repeat(100) });
    const retry = await pending('/state');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer ' + 'n'.repeat(100));
    retry.flush({ state: 'READY', requests: [] });
    expect(await result).toEqual({ state: 'READY', requests: [] });
    expect(cart.lines()).toEqual(before);
  });
  it('re-resolves the same QR with old ownership proof when renewal cannot recover', async () => {
    const result = api.submissionState(context.capability);
    (await pending('/state')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush({ state: 'EXPIRED' });
    const resolve = await pending('/resolve');
    expect(resolve.request.body).toEqual({ token, previousCapability: context.capability });
    resolve.flush(context);
    (await pending('/state')).flush({ state: 'READY', requests: [] });
    expect((await result).state).toBe('READY');
    expect(api.recovered()?.result).toEqual(context);
  });
  it('never loops when the single safe retry also expires', async () => {
    const result = api.submissionState(context.capability);
    (await pending('/state')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush(context);
    (await pending('/state')).flush({ state: 'EXPIRED' });
    expect(await result).toEqual({ state: 'EXPIRED' });
    http.expectNone((r) => r.url.endsWith('/renew'));
  });
  it('does not retry an uncertain write and keeps its original request identity', async () => {
    const body = {
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      lines: [
        {
          reference: 'r'.repeat(43),
          selectionRef: 's'.repeat(200),
          quantity: 1,
          note: '',
          presentedAmountMinor: 2500,
          currency: 'XOF',
        },
      ],
    };
    const result = api.submissions(context.capability, body);
    const rejected = expect(result).rejects.toBeDefined();
    (await pending('/submissions')).flush('Unavailable', {
      status: 503,
      statusText: 'Unavailable',
    });
    await rejected;
    http.expectNone((r) => r.url.endsWith('/renew'));
  });
  it('a safe expired write retry preserves the exact body and idempotency identity', async () => {
    const body = {
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      lines: [
        {
          reference: 'r'.repeat(43),
          selectionRef: 's'.repeat(200),
          quantity: 1,
          note: '',
          presentedAmountMinor: 2500,
          currency: 'XOF',
        },
      ],
    };
    const result = api.submissions(context.capability, body);
    (await pending('/submissions')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush(context);
    const retry = await pending('/submissions');
    expect(retry.request.body).toEqual(body);
    retry.flush({ state: 'REVIEW_REQUIRED' });
    expect((await result).state).toBe('REVIEW_REQUIRED');
  });
  it('revoked/inactive contexts still block without retrying an action', async () => {
    const result = api.submissionState(context.capability);
    (await pending('/state')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush({ state: 'UNAVAILABLE' });
    (await pending('/resolve')).flush({ state: 'UNAVAILABLE' });
    expect((await result).state).toBe('EXPIRED');
    expect(api.recovered()?.result.state).toBe('UNAVAILABLE');
    http.expectNone((r) => r.url.endsWith('/state'));
  });
  it('stale expiry cannot recover or replace a newly selected table', async () => {
    const result = api.submissionState(context.capability);
    const old = await pending('/state');
    api.configureRecovery('B'.repeat(43), 'another-table');
    old.flush({ state: 'EXPIRED' });
    expect((await result).state).toBe('EXPIRED');
    expect(api.recovered()).toBeNull();
    http.expectNone((r) => r.url.endsWith('/renew'));
  });
  it('an in-flight recovery cannot install its context after changing table', async () => {
    const result = api.submissionState(context.capability);
    (await pending('/state')).flush({ state: 'EXPIRED' });
    const renew = await pending('/renew');
    api.configureRecovery('B'.repeat(43), 'another-table');
    renew.flush(context);
    expect((await result).state).toBe('EXPIRED');
    expect(api.recovered()).toBeNull();
    http.expectNone((r) => r.url.endsWith('/state'));
  });
});
