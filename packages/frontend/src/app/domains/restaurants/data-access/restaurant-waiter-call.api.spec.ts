import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RestaurantGuestApi } from './restaurant-guest.api';
import { RestaurantsApi } from './restaurants.api';
import { AuthStore } from '../../identity/data-access/auth.store';
const outlet = '00000000-0000-4000-8000-000000000002',
  call = '00000000-0000-4000-8000-000000000081';
describe('Waiter Call validated clients', () => {
  const revision = signal(0);
  beforeEach(() => {
    revision.set(0);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: () => 'org',
            currentUserId: () => 'user',
            contextRevision: revision,
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });
  it('public client sends empty command and explicit Guest capability', async () => {
    const promise = TestBed.inject(RestaurantGuestApi).waiterCall('encrypted-guest');
    const req = TestBed.inject(HttpTestingController).expectOne((r) =>
      r.url.endsWith('/public/restaurants/guest/waiter-call'),
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    expect(req.request.headers.get('Authorization')).toBe('Bearer encrypted-guest');
    req.flush({ state: 'REQUESTED', requestedAt: new Date().toISOString() });
    expect((await promise).state).toBe('REQUESTED');
  });
  it('public client rejects leaked internal DTO fields', async () => {
    const promise = TestBed.inject(RestaurantGuestApi).waiterCall('encrypted-guest');
    const assertion = expect(promise).rejects.toThrow();
    TestBed.inject(HttpTestingController)
      .expectOne((r) => r.url.endsWith('/waiter-call'))
      .flush({ state: 'REQUESTED', requestedAt: new Date().toISOString(), orgId: 'org' });
    await assertion;
  });
  it('staff parses activity and rejects responses from stale workspace revisions', async () => {
    const api = TestBed.inject(RestaurantsApi);
    const ctx = { org: 'org', user: 'user', revision: 0, outlet };
    const promise = api.guestActivity(ctx);
    const assertion = expect(promise).rejects.toMatchObject({ status: 409 });
    revision.set(1);
    TestBed.inject(HttpTestingController)
      .expectOne((r) => r.url.endsWith('/guest-activity'))
      .flush({ items: [] });
    await assertion;
  });
  it('staff acknowledgement uses exact action identity and no ownership body', async () => {
    const ctx = { org: 'org', user: 'user', revision: 0, outlet };
    const promise = TestBed.inject(RestaurantsApi).acknowledgeWaiterCall(ctx, call);
    const req = TestBed.inject(HttpTestingController).expectOne((r) =>
      r.url.endsWith(`/waiter-calls/${call}/acknowledge`),
    );
    expect(req.request.body).toEqual({});
    req.flush({
      waiterCallId: call,
      state: 'ACKNOWLEDGED',
      acknowledgedAt: new Date().toISOString(),
    });
    expect((await promise).waiterCallId).toBe(call);
  });
});
