import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { RestaurantOrdersQueries } from './restaurant-orders.queries';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { RestaurantsApi } from './restaurants.api';
import { restaurantKeys } from './restaurants.queries';
import { RestaurantSessionReconciliation } from './restaurant-session-reconciliation';
const ctx: ServiceOrderContext = {
  org: 'org',
  user: 'waiter',
  revision: 3,
  outlet: 'outlet',
  session: 'session',
};
it.each([false, true])(
  'invalidates only exact domain queries (financial=%s)',
  async (financial) => {
    const client = new QueryClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantOrdersApi, useValue: {} },
        { provide: RestaurantsApi, useValue: {} },
      ],
    });
    const queries = TestBed.inject(RestaurantOrdersQueries);
    const unrelated = [
      ['me', 'workspaces'],
      ['me', 'product-access'],
      ['auth', 'current-user'],
      ['memberships'],
      restaurantKeys.serviceOrder('other', 'waiter', 'outlet', 'session', 3, 'orders'),
      restaurantKeys.floor('org', 'other'),
    ];
    for (const key of unrelated) client.setQueryData(key, { safe: true });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await queries.changed(ctx, 'order', financial, true);
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      queries.key(ctx, 'orders'),
      queries.key(ctx, 'order', 'order'),
      queries.key(ctx, 'items', 'order'),
      ...(financial
        ? [
            restaurantKeys.session('org', 'outlet', 'session', 'waiter'),
            restaurantKeys.floor('org', 'outlet'),
          ]
        : []),
    ]);
    for (const [filter] of invalidate.mock.calls) expect(filter?.exact).toBe(true);
    for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(TestBed.inject(RestaurantSessionReconciliation).contains(ctx)).toBe(false);
    client.clear();
    TestBed.resetTestingModule();
  },
);
