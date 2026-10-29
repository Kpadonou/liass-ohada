import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantsQueries, restaurantKeys } from './restaurants.queries';
import { context, row } from './restaurants.test-fixture';
describe('Restaurant query scope and invalidation', () => {
  const scope = signal('org-a');
  const api = { get: vi.fn(), list: vi.fn() };
  let queries: RestaurantsQueries, client: QueryClient;
  beforeEach(() => {
    scope.set('org-a');
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.get.mockReset();
    api.list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { effectiveOrgId: scope } },
        { provide: RestaurantsApi, useValue: api },
        { provide: QueryClient, useValue: client },
      ],
    });
    queries = TestBed.inject(RestaurantsQueries);
  });
  afterEach(() => {
    client.clear();
    TestBed.resetTestingModule();
  });
  it('uses stable keys with immutable parent context and no previous workspace placeholder', () => {
    expect(queries.list('table', context).queryKey).toEqual([
      'restaurants',
      'org-a',
      'table',
      context.outletId,
      context.areaId,
      context.categoryId,
    ]);
    const options = queries.get('restaurant');
    expect(options).not.toHaveProperty('placeholderData');
    scope.set('org-b');
    expect(queries.get('restaurant').queryKey).not.toEqual(options.queryKey);
    expect(queries.list('table', { ...context, areaId: 'other' }).queryKey).not.toEqual(
      queries.list('table', context).queryKey,
    );
  });
  it('does not expose previous cached restaurant data after workspace changes', async () => {
    api.get.mockResolvedValueOnce(row('restaurant'));
    await client.fetchQuery(queries.get('restaurant'));
    scope.set('org-b');
    expect(client.getQueryData(queries.get('restaurant').queryKey)).toBeUndefined();
    api.get.mockResolvedValueOnce(null);
    await expect(client.fetchQuery(queries.get('restaurant'))).resolves.toBeNull();
    expect(api.get).toHaveBeenLastCalledWith('org-b', 'restaurant', {});
  });
  it('invalidates the captured tenant collection rather than the newly selected workspace', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    scope.set('org-b');
    await queries.changed('org-a', 'item', context);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: restaurantKeys.collection('org-a', 'item', context),
    });
  });
  it('uses cursor pagination and disables requests without scope', async () => {
    api.list.mockResolvedValue({ items: [row('outlet')], nextCursor: 'next' });
    await client.fetchInfiniteQuery(queries.list('outlet'));
    expect(api.list).toHaveBeenCalledWith('org-a', 'outlet', {}, undefined);
    scope.set('');
    expect(queries.list('outlet').enabled).toBe(false);
    expect(queries.get('restaurant').enabled).toBe(false);
  });
});

it('session reads fence access revisions and late old-revision completions', async () => {
  const org = signal('org'),
    user = signal('u'),
    revision = signal(1);
  let release!: (value: object) => void;
  const api = {
    guestSession: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AuthStore,
        useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
      },
      { provide: RestaurantsApi, useValue: api },
      { provide: QueryClient, useValue: client },
    ],
  });
  const queries = TestBed.inject(RestaurantsQueries),
    options = queries.guestSession('outlet', 'visit');
  const pending = client.fetchQuery(options);
  const failed = expect(pending).rejects.toThrow('Stale session context');
  revision.set(2);
  expect(queries.guestSession('outlet', 'visit').queryKey).not.toEqual(options.queryKey);
  release({ guestSessionId: 'visit' });
  await failed;
  expect(client.getQueryData(queries.guestSession('outlet', 'visit').queryKey)).toBeUndefined();
  client.clear();
  TestBed.resetTestingModule();
});
