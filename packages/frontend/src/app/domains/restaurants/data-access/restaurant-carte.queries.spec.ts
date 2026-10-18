import { TestBed } from '@angular/core/testing';
import { QueryClient, InfiniteQueryObserver } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import {
  RestaurantCarteQueries,
  carteTokens,
  matchesCarteTokens,
  carteBytes,
  CARTE_BYTE_BUDGET,
  CARTE_PAGE_BUDGET,
} from './restaurant-carte.queries';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantsQueries, restaurantKeys } from './restaurants.queries';
import { RestaurantOrdersQueries } from './restaurant-orders.queries';
import { RestaurantOrdersApi } from './restaurant-orders.api';
import { AuthStore } from '../../identity/data-access/auth.store';
import { matchesMenuItemSearch } from '@liass-ohada/shared/restaurants';
const ctx = { org: 'org', user: 'user', revision: 1, outlet: 'outlet', menu: 'menu' };
const page = (nextCursor?: string) => ({
  outletId: ctx.outlet,
  menuId: ctx.menu,
  items: [],
  ...(nextCursor ? { nextCursor } : {}),
});
let client: QueryClient, queries: RestaurantCarteQueries;
const api = { cartePage: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: RestaurantsApi, useValue: api },
      { provide: RestaurantOrdersApi, useValue: {} },
      { provide: AuthStore, useValue: { effectiveOrgId: () => ctx.org } },
    ],
  });
  queries = TestBed.inject(RestaurantCarteQueries);
});
afterEach(() => {
  client.clear();
  TestBed.resetTestingModule();
});
it('uses an outlet/Menu key independent of session, table, category and search', () => {
  expect(queries.pages(ctx, true).queryKey).toEqual([
    'restaurants',
    'org',
    'operational-carte',
    'user',
    1,
    'outlet',
    'menu',
    'browse-v1',
  ]);
  for (const [field, value] of Object.entries({
    org: 'foreign',
    user: 'other',
    revision: 2,
    outlet: 'second',
    menu: 'new',
  }))
    expect(queries.pages({ ...ctx, [field]: value }, true).queryKey).not.toEqual(
      queries.pages(ctx, true).queryKey,
    );
});
it('reuses fresh pages between observers and bounds freshness/retention', async () => {
  api.cartePage.mockResolvedValue(page());
  const options = queries.pages(ctx, true);
  await client.fetchInfiniteQuery(options);
  await client.fetchInfiniteQuery(options);
  expect(api.cartePage).toHaveBeenCalledTimes(1);
  expect(options.staleTime).toBe(300000);
  expect(options.gcTime).toBe(900000);
});
it('accumulates sequential cursor pages and commits a coherent refreshed generation', async () => {
  api.cartePage.mockResolvedValueOnce(page('tail')).mockResolvedValueOnce(page());
  const observer = new InfiniteQueryObserver(client, queries.pages(ctx, true));
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
  expect(api.cartePage.mock.calls.map((call) => call[1])).toEqual([undefined, 'tail']);
  api.cartePage.mockResolvedValue(page());
  await observer.refetch();
  expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  unsubscribe();
});
it('preserves loaded pages after a failed continuation', async () => {
  api.cartePage
    .mockResolvedValueOnce(page('tail'))
    .mockRejectedValue(new HttpErrorResponse({ status: 503 }));
  const observer = new InfiniteQueryObserver(client, { ...queries.pages(ctx, true), retry: false });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
  expect(observer.getCurrentResult().hasNextPage).toBe(true);
  unsubscribe();
});
it('retries transient failures once and never retries authorization/configuration', () => {
  const retry = queries.pages(ctx, true).retry as (count: number, error: Error) => boolean;
  expect(retry(0, new HttpErrorResponse({ status: 503 }))).toBe(true);
  expect(retry(1, new HttpErrorResponse({ status: 503 }))).toBe(false);
  for (const status of [401, 403, 404, 409, 422])
    expect(retry(0, new HttpErrorResponse({ status }))).toBe(false);
});
it('defines finite physical-page and JSON-byte budgets', () => {
  expect(CARTE_PAGE_BUDGET).toBe(20);
  expect(CARTE_BYTE_BUDGET).toBe(2097152);
  expect(carteBytes([page()])).toBe(new TextEncoder().encode(JSON.stringify(page())).length);
});
it.each(['pou', 'bra', 'cafe', 'ana', 'jus ana', 'POU BRA', 'inconnu', ''])(
  'derived tokens agree with shared normalized matcher for %s',
  (query) => {
    for (const name of ['Poulet braisé sauce maison', 'Café crème', 'Jus d’ananas frais'])
      expect(matchesCarteTokens(carteTokens(name), carteTokens(query))).toBe(
        matchesMenuItemSearch(name, query),
      );
  },
);
it('invalidates only the affected outlet Carte on catalogue changes', async () => {
  const own = restaurantKeys.carte('org', 'user', 1, 'outlet', 'menu'),
    other = restaurantKeys.carte('org', 'user', 1, 'other', 'menu');
  client.setQueryData(own, {});
  client.setQueryData(other, {});
  await TestBed.inject(RestaurantsQueries).changed('org', 'item', {
    outletId: 'outlet',
    categoryId: 'category',
  });
  expect(client.getQueryState(own)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});
it('does not invalidate Carte on ordinary Order or financial reconciliation', async () => {
  const key = queries.pages(ctx, true).queryKey;
  client.setQueryData(key, { pages: [page()], pageParams: [undefined] });
  await TestBed.inject(RestaurantOrdersQueries).changed(
    { ...ctx, session: 'session' },
    'order',
    true,
  );
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});
it('caps refreshed generations even after explicit continuation beyond the automatic budget', async () => {
  let budget = { pages: 20, bytes: CARTE_BYTE_BUDGET };
  api.cartePage.mockImplementation(async (_ctx, cursor) => page(String(Number(cursor ?? 0) + 1)));
  const options = queries.pages(
    ctx,
    true,
    () => budget,
    () => {
      budget = { pages: 20, bytes: CARTE_BYTE_BUDGET };
    },
  );
  const observer = new InfiniteQueryObserver(client, options),
    unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  budget = { pages: 25, bytes: CARTE_BYTE_BUDGET };
  for (let i = 1; i < 25; i++) await observer.fetchNextPage();
  expect(observer.getCurrentResult().data?.pages).toHaveLength(25);
  api.cartePage.mockClear();
  await observer.refetch();
  expect(api.cartePage).toHaveBeenCalledTimes(20);
  expect(observer.getCurrentResult().data?.pages).toHaveLength(20);
  expect(observer.getCurrentResult().data?.pages.at(-1)?.nextCursor).toBe('20');
  unsubscribe();
});
it('stops at JSON page boundaries independently of the physical page cap', async () => {
  api.cartePage.mockResolvedValue(page('next'));
  const observer = new InfiniteQueryObserver(
      client,
      queries.pages(ctx, true, () => ({ pages: 20, bytes: 1 })),
    ),
    unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  expect(observer.getCurrentResult().data?.pages.at(-1)?.nextCursor).toBe('next');
  expect(api.cartePage).toHaveBeenCalledTimes(1);
  unsubscribe();
});
