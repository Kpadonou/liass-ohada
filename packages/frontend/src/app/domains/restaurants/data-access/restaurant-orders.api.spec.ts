import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { restaurantKeys } from './restaurants.queries';
import { rid } from './restaurants.test-fixture';
import { signal } from '@angular/core';
const org = signal('org'),
  user = signal('waiter'),
  revision = signal(1);
const ctx: ServiceOrderContext = {
  org: 'org',
  user: 'waiter',
  revision: 1,
  outlet: rid(2),
  session: rid(9),
};
let api: RestaurantOrdersApi, http: HttpTestingController;
beforeEach(() => {
  org.set('org');
  user.set('waiter');
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
  api = TestBed.inject(RestaurantOrdersApi);
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});
it('uses bounded canonical session Orders with an explicit cursor', async () => {
  const pending = api.orders(ctx, 'cursor');
  const req = http.expectOne((r) => r.url.endsWith(`/sessions/${rid(9)}/orders`));
  expect(req.request.params.get('limit')).toBe('100');
  expect(req.request.params.get('cursor')).toBe('cursor');
  req.flush({ items: [], nextCursor: 'next' });
  expect(await pending).toEqual({ items: [], nextCursor: 'next' });
});
it.each(['organization', 'principal', 'revision'])(
  'rejects late %s data even for empty pages',
  async (dimension) => {
    const pending = api.orders(ctx);
    const checked = expect(pending).rejects.toThrow();
    const req = http.expectOne((r) => r.url.endsWith('/orders'));
    if (dimension === 'organization') org.set('other');
    if (dimension === 'principal') user.set('other');
    if (dimension === 'revision') revision.set(2);
    req.flush({ items: [] });
    await checked;
  },
);
it('separates user/org/outlet/session/order/revision query keys', () => {
  const key = (
    org = 'org',
    user = 'waiter',
    outlet = rid(2),
    session = rid(9),
    revision = 1,
    order = rid(20),
  ) => restaurantKeys.serviceOrder(org, user, outlet, session, revision, 'items', order);
  expect(
    new Set(
      [
        key(),
        key('foreign'),
        key('org', 'owner'),
        key('org', 'waiter', rid(3)),
        key('org', 'waiter', rid(2), rid(10)),
        key('org', 'waiter', rid(2), rid(9), 2),
        key('org', 'waiter', rid(2), rid(9), 1, rid(21)),
      ].map((value) => JSON.stringify(value)),
    ).size,
  ).toBe(7);
});
it('rejects forged request fields before HTTP, including waiter attribution and sale price', async () => {
  await expect(
    api.command(ctx, 'create', {
      clientRequestId: rid(70),
      orderType: 'DINE_IN',
      guestSessionId: rid(9),
      waiterId: 'other',
    }),
  ).rejects.toThrow();
  await expect(
    api.command(
      ctx,
      'add',
      {
        clientRequestId: rid(71),
        expectedVersion: 1,
        menuItemId: rid(8),
        categoryId: rid(6),
        quantity: 1,
        expectedMenuItemVersion: 1,
        price: 1,
      },
      rid(20),
    ),
  ).rejects.toThrow();
  http.expectNone(() => true);
});
it('routes draft removal only to the existing item command and preserves expected versions', async () => {
  const pending = api.command(
    ctx,
    'remove',
    {
      clientRequestId: rid(70),
      expectedVersion: 3,
      expectedItemVersion: 2,
      reason: 'Draft correction',
    },
    rid(20),
    rid(21),
  );
  const checked = expect(pending).rejects.toThrow();
  const req = http.expectOne((r) => r.url.endsWith(`/orders/${rid(20)}/items/${rid(21)}/cancel`));
  expect(req.request.method).toBe('POST');
  expect(req.request.body).toMatchObject({ expectedVersion: 3, expectedItemVersion: 2 });
  req.flush({ data: {} });
  await checked;
});
it('rejects oversized rounds before any HTTP call', async () => {
  await expect(
    api.command(
      ctx,
      'submit',
      {
        clientRequestId: rid(70),
        expectedVersion: 3,
        items: Array.from({ length: 13 }, (_, i) => ({ itemId: rid(100 + i), expectedVersion: 1 })),
      },
      rid(20),
    ),
  ).rejects.toThrow();
  http.expectNone(() => true);
});
it('rejects foreign organization Orders and same-outlet Orders from another session', async () => {
  const order = {
    orgId: 'org',
    outletId: rid(2),
    schemaVersion: 1,
    orderId: rid(20),
    guestSessionId: rid(9),
    tableId: rid(5),
    orderType: 'DINE_IN',
    status: 'DRAFT',
    currency: 'XOF',
    createdAt: '2026-10-16T12:00:00.000Z',
    createdBy: 'waiter',
    version: 1,
    financialRevision: 0,
    lineCount: 0,
    acceptedLineCount: 0,
    draftLineCount: 0,
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
  };
  const first = api.orders(ctx);
  const rejected = expect(first).rejects.toThrow('ownership');
  http
    .expectOne((r) => r.url.endsWith('/orders'))
    .flush({ items: [{ ...order, orgId: 'foreign' }] });
  await rejected;
  const second = api.order(ctx, rid(20));
  const rejected2 = expect(second).rejects.toThrow('ownership');
  http
    .expectOne((r) => r.url.endsWith(`/orders/${rid(20)}`))
    .flush({ data: { ...order, guestSessionId: rid(99) } });
  await rejected2;
});

it('returns a validated accepted-line cancellation from the existing route without any order/session closure', async () => {
  const input = {
    clientRequestId: rid(70),
    expectedVersion: 8,
    expectedItemVersion: 2,
    reason: 'Wrong item',
  };
  const result = {
    orgId: 'org',
    outletId: rid(2),
    orderId: rid(20),
    itemId: rid(21),
    menuItemId: rid(7),
    categoryId: rid(6),
    schemaVersion: 1,
    status: 'CANCELLED',
    quantity: 2,
    expectedMenuItemVersion: 1,
    version: 3,
    createdAt: '2026-10-18T10:00:00.000Z',
    cancelledAt: '2026-11-02T10:00:00.000Z',
    cancelledBy: 'manager',
    cancellationReason: 'Wrong item',
    snapshot: {
      menuItemId: rid(7),
      menuId: rid(8),
      categoryId: rid(6),
      itemVersion: 1,
      categoryVersion: 1,
      menuVersion: 1,
      name: 'Water',
      quantity: 2,
      unitPriceMinor: 1500,
      grossMinor: 3000,
      subtotalMinor: 3000,
      discountMinor: 0,
      taxMinor: 0,
      lineTotalMinor: 3000,
      currency: 'XOF',
      acceptedAt: '2026-10-18T10:01:00.000Z',
      acceptedBy: 'waiter',
      submissionId: rid(40),
    },
  };
  const pending = api.command(ctx, 'remove', input, rid(20), rid(21));
  const request = http.expectOne((r) =>
    r.url.endsWith(`/orders/${rid(20)}/items/${rid(21)}/cancel`),
  );
  expect(request.request.body).toEqual(input);
  request.flush({ data: result });
  expect(await pending).toEqual(result);
  http.expectNone((r) => /\/close$|\/orders\/[^/]+\/cancel$/.test(r.url));
});
