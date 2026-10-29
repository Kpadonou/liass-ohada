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
