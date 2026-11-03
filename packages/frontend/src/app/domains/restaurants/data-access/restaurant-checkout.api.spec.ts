import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantCheckoutApi } from './restaurant-checkout.api';
import { rid } from './restaurants.test-fixture';
import { sessionFixture } from './responsible-staff.test-fixture';
const org = signal('org'),
  user = signal('cashier'),
  revision = signal(1);
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
describe('Checkout command contract and context isolation', () => {
  let api: RestaurantCheckoutApi, http: HttpTestingController;
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
    api = TestBed.inject(RestaurantCheckoutApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('posts final closure to existing canonical route and accepts CLOSED replay', async () => {
    const input = { clientRequestId: rid(88), expectedVersion: 1 };
    const promise = api.closeSession(ctx, input);
    const request = http.expectOne((r) =>
      r.url.endsWith(`/outlets/${rid(2)}/sessions/${rid(9)}/close`),
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(input);
    request.flush({ data: { ...sessionFixture(), status: 'CLOSED' } });
    expect((await promise).status).toBe('CLOSED');
  });
  it('accepts server-confirmed technical cancellation from normal Order close', async () => {
    const promise = api.closeOrder(ctx, rid(20), { clientRequestId: rid(88), expectedVersion: 1 });
    const terminal = {
      orgId: 'org',
      outletId: rid(2),
      guestSessionId: rid(9),
      orderId: rid(20),
      schemaVersion: 1,
      orderType: 'DINE_IN',
      status: 'CANCELLED',
      currency: 'XOF',
      createdAt: '2026-10-18T10:00:00.000Z',
      createdBy: 'waiter',
      version: 2,
      financialRevision: 0,
      lineCount: 0,
      acceptedLineCount: 0,
      draftLineCount: 0,
      dueMinor: 0,
      paidMinor: 0,
      reservedMinor: 0,
      pendingPaymentCount: 0,
    };
    http.expectOne((r) => r.url.endsWith(`/orders/${rid(20)}/close`)).flush({ data: terminal });
    expect(await promise).toEqual(terminal);
    http.expectNone((r) => r.url.endsWith(`/sessions/${rid(9)}/close`));
  });
  it.each(['org', 'user', 'revision'])('rejects late closure after %s change', async (field) => {
    const promise = api.closeSession(ctx, { clientRequestId: rid(88), expectedVersion: 1 });
    const assertion = expect(promise).rejects.toBeDefined();
    const request = http.expectOne((r) => r.url.endsWith('/close'));
    if (field === 'org') org.set('foreign');
    if (field === 'user') user.set('other');
    if (field === 'revision') revision.set(2);
    request.flush({ data: { ...sessionFixture(), status: 'CLOSED' } });
    await assertion;
  });
  it('rejects foreign parent response instead of displaying a successful closure', async () => {
    const promise = api.closeSession(ctx, { clientRequestId: rid(88), expectedVersion: 1 });
    const assertion = expect(promise).rejects.toBeDefined();
    http
      .expectOne((r) => r.url.endsWith('/close'))
      .flush({ data: { ...sessionFixture(), outletId: rid(12), status: 'CLOSED' } });
    await assertion;
  });
  it('validates payment intent before sending any request', async () => {
    await expect(
      api.capture(ctx, {
        clientRequestId: rid(88),
        expectedVersion: 1,
        method: 'CARD',
        currency: 'XOF',
        allocations: [{ orderId: rid(20), amountMinor: -1 }],
      }),
    ).rejects.toBeDefined();
    http.expectNone(() => true);
  });
});
