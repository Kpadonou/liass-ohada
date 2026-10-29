import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, Subject } from 'rxjs';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { RestaurantCashQueries, cashKeys, CashContext } from './restaurant-cash.queries';
import * as c from '@liass-ohada/shared/restaurants';
import { rid } from './restaurants.test-fixture';
const initial: CashContext = {
  org: 'org',
  user: 'cashier',
  revision: 1,
  outlet: rid(2),
  identity: 'access',
};
const day: c.RestaurantBusinessDay = {
  orgId: 'org',
  outletId: rid(2),
  businessDayId: rid(3),
  businessDate: '2026-10-29',
  operationalTimezone: 'Africa/Porto-Novo',
  currency: 'XOF',
  status: 'OPEN',
  openedAt: '2026-10-29T05:00:00.000Z',
  openedBy: 'owner',
  version: 1,
  sessionCount: 1,
  openSessionCount: 1,
};
const session: c.RestaurantCashSession = {
  orgId: 'org',
  outletId: rid(2),
  cashSessionId: rid(4),
  businessDayId: rid(3),
  cashierUserId: 'cashier',
  cashierDisplayName: 'Alice',
  openedAt: day.openedAt,
  openedBy: 'cashier',
  openingCashAmountMinor: 100,
  currency: 'XOF',
  status: 'OPEN',
  version: 1,
  paymentCount: 1,
  paidByMethodMinor: { CASH: 200, CARD: 500, MOBILE_MONEY: 100 },
  cashInMinor: 0,
  cashOutMinor: 0,
  expectedCashAmountMinor: 300,
};
describe('Cash authoritative cache and request counts', () => {
  let scope: CashContext, client: QueryClient, api: RestaurantCashQueries;
  const http = { get: vi.fn(), post: vi.fn() };
  beforeEach(() => {
    scope = { ...initial };
    vi.resetAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: HttpClient, useValue: http },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: () => scope.org,
            currentUserId: () => scope.user,
            contextRevision: () => scope.revision,
          },
        },
        {
          provide: RestaurantOutletContext,
          useValue: { id: () => scope.outlet, identity: () => scope.identity },
        },
      ],
    });
    api = TestBed.inject(RestaurantCashQueries);
  });
  afterEach(() => {
    client.clear();
    TestBed.resetTestingModule();
  });
  function seed() {
    client.setQueryData(cashKeys.read(initial, 'business-days/current'), { data: day });
    client.setQueryData(cashKeys.read(initial, 'cash-sessions/current'), { data: session });
  }
  it('warm Checkout and remount reuse both discovery responses', async () => {
    seed();
    expect(await api.requirePayment(initial)).toBe(true);
    expect(await api.requirePayment(initial)).toBe(true);
    expect(http.get).not.toHaveBeenCalled();
  });
  it.each(['day', 'session', 'closed', 'foreign'])(
    'rejects payment with %s context',
    async (type) => {
      seed();
      if (type === 'day')
        client.setQueryData(cashKeys.read(initial, 'business-days/current'), { data: null });
      else
        client.setQueryData(cashKeys.read(initial, 'cash-sessions/current'), {
          data:
            type === 'session'
              ? null
              : {
                  ...session,
                  ...(type === 'closed' ? { status: 'CLOSED' } : { businessDayId: rid(9) }),
                },
        });
      expect(await api.requirePayment(initial)).toBe(false);
      expect(http.get).not.toHaveBeenCalled();
    },
  );
  it.each([
    { outlet: rid(8) },
    { org: 'other' },
    { user: 'other' },
    { revision: 2 },
    { identity: 'changed' },
  ])('rejects obsolete scope %j', async (changed) => {
    seed();
    scope = { ...scope, ...changed };
    await expect(api.requirePayment(initial)).rejects.toThrow();
  });
  it('late transport response cannot populate the new Outlet', async () => {
    const response = new Subject<unknown>();
    http.get.mockReturnValue(response);
    const pending = api.request(
      initial,
      'business-days/current',
      c.RestaurantCurrentBusinessDayResponseSchema,
    );
    scope = { ...scope, outlet: rid(9) };
    response.next({ data: day });
    response.complete();
    await expect(pending).rejects.toThrow('Cash context changed');
    expect(client.getQueryData(cashKeys.read(scope, 'business-days/current'))).toBeUndefined();
  });
  it.each([0, 20, -20])(
    'close freezes variance %s, replaces target/list and reconciles only dependent day reads',
    async (variance) => {
      seed();
      const closed = {
        ...session,
        status: 'CLOSED' as const,
        version: 2,
        countedCashAmountMinor: 300 + variance,
        varianceAmountMinor: variance,
        closedAt: '2026-10-30T01:00:00.000Z',
        closedBy: 'cashier',
      };
      const list = `business-days/${day.businessDayId}/cash-sessions`;
      client.setQueryData(cashKeys.read(initial, list), { items: [session] });
      const invalid = vi.spyOn(client, 'invalidateQueries');
      await api.confirmedSession(initial, closed);
      expect(client.getQueryData(cashKeys.read(initial, 'cash-sessions/current'))).toEqual({
        data: closed,
      });
      expect(
        client.getQueryData(cashKeys.read(initial, `cash-sessions/${session.cashSessionId}`)),
      ).toEqual({ data: closed });
      expect(client.getQueryData(cashKeys.read(initial, list))).toEqual({ items: [closed] });
      expect(invalid.mock.calls.map(([v]) => v?.queryKey)).toEqual([
        cashKeys.read(initial, 'business-days/current'),
        cashKeys.read(initial, `business-days/${day.businessDayId}/summary`),
      ]);
      expect(http.get).not.toHaveBeenCalled();
    },
  );
  it('manager closing Alice never replaces their own current session', async () => {
    scope = { ...scope, user: 'manager' };
    const own = { ...session, cashSessionId: rid(8), cashierUserId: 'manager' };
    client.setQueryData(cashKeys.read(scope, 'cash-sessions/current'), { data: own });
    await api.confirmedSession(scope, { ...session, status: 'CLOSED' });
    expect(client.getQueryData(cashKeys.read(scope, 'cash-sessions/current'))).toEqual({
      data: own,
    });
  });
  it('day close updates detail/current/loaded summary without opening another day or GET', async () => {
    seed();
    const path = `business-days/${day.businessDayId}/summary`;
    client.setQueryData(cashKeys.read(initial, path), { data: { businessDay: day, sessions: [] } });
    const closed = { ...day, status: 'CLOSED' as const, openSessionCount: 0, version: 2 };
    await api.confirmedDay(initial, closed);
    expect(client.getQueryData(cashKeys.read(initial, 'business-days/current'))).toEqual({
      data: null,
    });
    expect(
      client.getQueryData(cashKeys.read(initial, `business-days/${day.businessDayId}`)),
    ).toEqual({ data: closed });
    expect(client.getQueryData(cashKeys.read(initial, path))).toEqual({
      data: { businessDay: closed, sessions: [] },
    });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it.each(['CASH_IN', 'CASH_OUT'] as const)(
    '%s joins immutable newest-first history with no exact movement GET',
    async (type) => {
      seed();
      const movement: c.RestaurantCashMovement = {
        orgId: 'org',
        outletId: rid(2),
        movementId: rid(7),
        cashSessionId: session.cashSessionId,
        businessDayId: day.businessDayId,
        type,
        amountMinor: 50,
        currency: 'XOF',
        reason: 'Float',
        actorId: 'owner',
        occurredAt: day.openedAt,
        createdAt: day.openedAt,
        clientRequestId: rid(8),
      };
      const path = `cash-sessions/${session.cashSessionId}/movements`;
      client.setQueryData(cashKeys.read(initial, path), { items: [] });
      const invalid = vi.spyOn(client, 'invalidateQueries');
      await api.confirmedMovement(initial, movement);
      await api.confirmedMovement(initial, movement);
      expect(client.getQueryData(cashKeys.read(initial, path))).toEqual({ items: [movement] });
      expect(invalid.mock.calls.every(([v]) => v?.exact === true)).toBe(true);
      expect(http.get).not.toHaveBeenCalled();
      expect(client.getQueryData(cashKeys.read(initial, 'cash-sessions/current'))).toEqual({
        data: session,
      });
    },
  );
  it.each([
    'business-days/open',
    'cash-sessions',
    `cash-sessions/${rid(4)}/movements`,
    `cash-sessions/${rid(4)}/close`,
    `business-days/${rid(3)}/close`,
  ])(
    '%s does not publish success before confirmation and reuses ambiguous identity',
    async (path) => {
      seed();
      http.post.mockImplementation(() => {
        throw new HttpErrorResponse({ status: 0 });
      });
      await expect(
        api.command(initial, path, { value: 1 }, c.RestaurantCurrentBusinessDayResponseSchema),
      ).rejects.toBeTruthy();
      const first = http.post.mock.calls[0][1];
      await expect(
        api.command(initial, path, { value: 1 }, c.RestaurantCurrentBusinessDayResponseSchema),
      ).rejects.toBeTruthy();
      expect(http.post.mock.calls[1][1]).toEqual(first);
      expect(client.getQueryData(cashKeys.read(initial, 'business-days/current'))).toEqual({
        data: day,
      });
    },
  );
});

describe('Cash column preferences', () => {
  it('persists the stable key and keeps required columns without changing business records', async () => {
    const { saveTablePreferences, loadTablePreferences } =
      await import('../../../shared/ui/table-preferences/table-preferences.storage');
    const columns = [
      { id: 'CASHIER', labelKey: 'cashier', required: true },
      { id: 'CARD', labelKey: 'card' },
      { id: 'ACTIONS', labelKey: 'actions', required: true },
    ];
    const before = JSON.stringify(session);
    saveTablePreferences('restaurants.cash.sessions', columns, ['CARD']);
    expect(loadTablePreferences('restaurants.cash.sessions', columns)).toEqual([
      'CASHIER',
      'CARD',
      'ACTIONS',
    ]);
    saveTablePreferences('restaurants.cash.sessions', columns, []);
    expect(loadTablePreferences('restaurants.cash.sessions', columns)).toEqual([
      'CASHIER',
      'ACTIONS',
    ]);
    expect(JSON.stringify(session)).toBe(before);
  });
});
