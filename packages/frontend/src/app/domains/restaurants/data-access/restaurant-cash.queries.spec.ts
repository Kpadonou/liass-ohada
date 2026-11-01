import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { cashKeys, CashContext } from './restaurant-cash.queries';
const scope: CashContext = {
  org: 'org',
  outlet: 'outlet',
  user: 'cashier',
  revision: 1,
  identity: 'access',
};
describe('Cash cache boundaries', () => {
  it('isolates organization, Outlet, principal and access revision', () => {
    const base = cashKeys.read(scope, 'business-days/current');
    for (const changed of [
      { org: 'other' },
      { outlet: 'other' },
      { user: 'other' },
      { revision: 2 },
      { identity: 'other' },
    ])
      expect(cashKeys.read({ ...scope, ...changed }, 'business-days/current')).not.toEqual(base);
  });
  it('reuses a fresh current-day response across navigation', async () => {
    const client = new QueryClient();
    let calls = 0;
    const options = {
      queryKey: cashKeys.read(scope, 'business-days/current'),
      staleTime: 30000,
      queryFn: async () => {
        calls++;
        return { data: null };
      },
    };
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    expect(calls).toBe(1);
    client.clear();
  });
  it('canonical session seeding avoids an immediate exact-session read', async () => {
    const client = new QueryClient();
    const key = cashKeys.read(scope, 'cash-sessions/session');
    let calls = 0;
    client.setQueryData(key, { data: { status: 'OPEN' } });
    const result = await client.fetchQuery({
      queryKey: key,
      staleTime: 30000,
      queryFn: async () => {
        calls++;
        return { data: { status: 'OPEN' } };
      },
    });
    expect(result.data.status).toBe('OPEN');
    expect(calls).toBe(0);
    client.clear();
  });
});
it('loads each activity page once and reuses fresh tab history', async () => {
  const { RestaurantCashQueries } = await import('./restaurant-cash.queries');
  const queries = Object.create(RestaurantCashQueries.prototype) as InstanceType<
    typeof RestaurantCashQueries
  >;
  const paths: string[] = [];
  Object.assign(queries, {
    request: async (_scope: CashContext, path: string) => {
      paths.push(path);
      return { items: [] };
    },
  });
  const client = new QueryClient();
  await client.fetchQuery(queries.payments(scope, 'session'));
  await client.fetchQuery(queries.movements(scope, 'session'));
  await client.fetchQuery(queries.payments(scope, 'session'));
  await client.fetchQuery(queries.movements(scope, 'session'));
  expect(paths).toEqual(['cash-sessions/session/payments', 'cash-sessions/session/movements']);
  client.clear();
});

it('binds payment search and pagination to a stable query path', async () => {
  const { RestaurantCashQueries } = await import('./restaurant-cash.queries');
  const queries = Object.create(RestaurantCashQueries.prototype) as InstanceType<
    typeof RestaurantCashQueries
  >;
  const paths: string[] = [];
  Object.assign(queries, {
    request: async (_scope: CashContext, path: string) => {
      paths.push(path);
      return { items: [] };
    },
  });
  const client = new QueryClient();
  await client.fetchQuery(queries.payments(scope, 'session', undefined, '0F93B571'));
  await client.fetchQuery(queries.payments(scope, 'session', 'next page', 'Table A'));
  await client.fetchQuery(queries.payments(scope, 'session'));
  expect(paths).toEqual([
    'cash-sessions/session/payments?q=0F93B571',
    'cash-sessions/session/payments?q=Table+A&cursor=next+page',
    'cash-sessions/session/payments',
  ]);
  client.clear();
});

it('refreshes the authoritative session count after a confirmed movement', async () => {
  const { RestaurantCashQueries } = await import('./restaurant-cash.queries');
  const queries = Object.create(RestaurantCashQueries.prototype) as InstanceType<
    typeof RestaurantCashQueries
  >;
  const client = new QueryClient();
  Object.assign(queries, { client, assert: () => undefined });
  const key = cashKeys.read(scope, 'cash-sessions/current');
  client.setQueryData(key, { data: { cashMovementCount: 1 } });
  await queries.confirmedMovement(scope, {
    cashSessionId: 'session',
    businessDayId: 'day',
    movementId: 'movement',
    occurredAt: '2026-10-30T10:00:00.000Z',
  } as Parameters<InstanceType<typeof RestaurantCashQueries>['confirmedMovement']>[1]);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  let reads = 0;
  const current = await client.fetchQuery({
    queryKey: key,
    staleTime: 30000,
    queryFn: async () => {
      reads++;
      return { data: { cashMovementCount: 2 } };
    },
  });
  expect(current.data.cashMovementCount).toBe(2);
  expect(reads).toBe(1);
  client.clear();
});

it('seeds confirmed movement count without a redundant current-session GET', async () => {
  const { RestaurantCashQueries } = await import('./restaurant-cash.queries');
  const queries = Object.create(RestaurantCashQueries.prototype) as InstanceType<
    typeof RestaurantCashQueries
  >;
  const client = new QueryClient();
  Object.assign(queries, { client, assert: () => undefined });
  const key = cashKeys.read(scope, 'cash-sessions/current');
  client.setQueryData(key, { data: { cashSessionId: 'session', cashMovementCount: 4 } });
  await queries.confirmedMovement(
    scope,
    {
      cashSessionId: 'session',
      businessDayId: 'day',
      movementId: 'movement',
      occurredAt: '2026-10-30T10:00:00.000Z',
    } as Parameters<InstanceType<typeof RestaurantCashQueries>['confirmedMovement']>[1],
    {
      cashSessionId: 'session',
      businessDayId: 'day',
      cashierUserId: 'cashier',
      cashMovementCount: 5,
    } as Parameters<InstanceType<typeof RestaurantCashQueries>['confirmedMovement']>[2],
  );
  let reads = 0;
  const current = await client.fetchQuery({
    queryKey: key,
    staleTime: 30000,
    queryFn: async () => {
      reads++;
      return { data: { cashSessionId: 'session', cashMovementCount: 99 } };
    },
  });
  expect(current.data.cashMovementCount).toBe(5);
  expect(reads).toBe(0);
  client.clear();
});
