import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { RestaurantInventoryQueries, inventoryKeys } from './restaurant-inventory.queries';
import { RestaurantInventoryApi } from './restaurant-inventory.api';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantsQueries, restaurantKeys } from './restaurants.queries';
import { inventoryContext as ctx, stockItem, stockMovement } from './inventory.test-fixture';
import { row, rid } from './restaurants.test-fixture';
import type { CursorData } from '../../../core/query-cache/confirmed-pages';
import type { StockItemResponseData } from '@liass-ohada/shared/restaurants';

const org = signal(ctx.org),
  user = signal(ctx.user),
  revision = signal(ctx.revision),
  outlet = signal(ctx.outlet),
  identity = signal(ctx.identity);
let client: QueryClient, http: HttpTestingController, queries: RestaurantInventoryQueries;
let requests: string[], cleanups: (() => void)[];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const pages = <T>(items: T[], nextCursor?: string): CursorData<T> => ({
  pages: [{ items, ...(nextCursor ? { nextCursor } : {}) }],
  pageParams: [undefined],
});
beforeEach(() => {
  org.set(ctx.org);
  user.set(ctx.user);
  revision.set(ctx.revision);
  outlet.set(ctx.outlet);
  identity.set(ctx.identity);
  requests = [];
  cleanups = [];
  const count: HttpInterceptorFn = (request, next) => {
    requests.push(`${request.method} ${request.url}`);
    return next(request);
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([count])),
      provideHttpClientTesting(),
      { provide: QueryClient, useValue: client },
      {
        provide: AuthStore,
        useValue: { effectiveOrgId: org, currentUserId: user, contextRevision: revision },
      },
      { provide: RestaurantOutletContext, useValue: { id: outlet, identity } },
      { provide: RestaurantsCapabilities, useValue: { canManageInventory: () => true } },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  queries = TestBed.inject(RestaurantInventoryQueries);
});
afterEach(() => {
  cleanups.forEach((close) => close());
  http.verify();
  client.clear();
  TestBed.resetTestingModule();
});
async function loadedItems(nextCursor?: string) {
  const observer = new InfiniteQueryObserver(client, queries.items(ctx, true));
  const close = observer.subscribe(() => {});
  cleanups.push(close);
  http
    .expectOne((r) => r.url.endsWith('/inventory/items'))
    .flush({ items: [stockItem()], ...(nextCursor ? { nextCursor } : {}) });
  await tick();
  return observer;
}
async function loadedDetail() {
  const observer = new QueryObserver(client, queries.item(ctx, stockItem().id, true));
  cleanups.push(observer.subscribe(() => {}));
  http.expectOne((r) => r.url.endsWith('/items/' + stockItem().id)).flush({ data: stockItem() });
  await tick();
  return observer;
}
it('PATCH executes one HTTP request, updates loaded detail/list and does not speculate or GET again', async () => {
  await loadedItems('next');
  await loadedDetail();
  requests = [];
  const saving = queries.save(ctx, stockItem().id, { expectedVersion: 1, name: 'New name' });
  const request = http.expectOne((r) => r.method === 'PATCH');
  expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toEqual(stockItem());
  const canonical = stockItem({
    name: 'New name',
    version: 2,
    balanceMilli: -1000,
    isNegativeStock: true,
  });
  request.flush({ data: canonical });
  await saving;
  expect(requests).toHaveLength(1);
  expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toEqual(canonical);
  expect(
    client.getQueryData<CursorData<StockItemResponseData>>(inventoryKeys.items(ctx))?.pages[0],
  ).toEqual({ items: [canonical], nextCursor: 'next' });
  http.expectNone((r) => r.method === 'GET');
});
it('POST inserts a canonical row into an exhaustive collection without GETs or invented balances', async () => {
  await loadedItems();
  requests = [];
  const canonical = stockItem({ id: rid(79), name: 'New', balanceMilli: 0, version: 1 });
  const saving = queries.save(ctx, null, { name: 'New', unit: 'BOTTLE' });
  http.expectOne((r) => r.method === 'POST').flush({ data: canonical });
  await saving;
  expect(requests).toHaveLength(1);
  const data = client.getQueryData<CursorData<StockItemResponseData>>(inventoryKeys.items(ctx))!;
  expect(data.pages[0].items.map((item) => item.id)).toEqual([rid(79), stockItem().id]);
  expect(data.pageParams).toEqual([undefined]);
  expect(client.getQueryData(inventoryKeys.item(ctx, canonical.id))).toEqual(canonical);
});
it('POST retains targeted reconciliation for a partial collection without inserting an unproven page member', async () => {
  await loadedItems('next');
  requests = [];
  const canonical = stockItem({ id: rid(99), name: 'New', balanceMilli: 0 });
  const saving = queries.save(ctx, null, { name: 'New', unit: 'BOTTLE' });
  http.expectOne((r) => r.method === 'POST').flush({ data: canonical });
  await tick();
  expect(
    client.getQueryData<CursorData<StockItemResponseData>>(inventoryKeys.items(ctx))?.pages[0]
      .items,
  ).toEqual([stockItem()]);
  http
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/inventory/items'))
    .flush({ items: [stockItem()], nextCursor: 'next' });
  await saving;
  expect(requests.filter((r) => r.startsWith('GET'))).toHaveLength(1);
});
it.each(['CREATE', 'LINK', 'REMOVE'] as const)(
  'confirmed tracking %s has one command and zero tracking GETs',
  async (mode) => {
    const category = rid(6),
      menuItem = rid(8);
    const observer = new QueryObserver(client, queries.tracking(ctx, category, menuItem, true));
    cleanups.push(observer.subscribe(() => {}));
    http
      .expectOne((r) => r.method === 'GET')
      .flush({ data: { menuItemId: menuItem, version: 0, stockItem: null } });
    await tick();
    requests = [];
    const base = { categoryId: category, clientRequestId: crypto.randomUUID(), expectedVersion: 0 };
    const command =
      mode === 'REMOVE'
        ? base
        : mode === 'CREATE'
          ? { ...base, mode, unit: 'BOTTLE' as const }
          : { ...base, mode, stockItemId: stockItem().id };
    const saving = queries.saveTracking(ctx, category, menuItem, command);
    const result = {
      menuItemId: menuItem,
      version: 1,
      stockItem: mode === 'REMOVE' ? null : stockItem(),
    };
    http
      .expectOne((r) => r.method === (mode === 'REMOVE' ? 'DELETE' : 'PUT'))
      .flush({ data: result });
    await saving;
    expect(requests).toHaveLength(1);
    expect(observer.getCurrentResult().data).toEqual(result);
  },
);
it('tracking dispatch uncertainty still re-reads canonical state using the same caller intent', async () => {
  const category = rid(6),
    menuItem = rid(8);
  const observer = new QueryObserver(client, queries.tracking(ctx, category, menuItem, true));
  cleanups.push(observer.subscribe(() => {}));
  http
    .expectOne((r) => r.method === 'GET')
    .flush({ data: { menuItemId: menuItem, version: 0, stockItem: null } });
  await tick();
  requests = [];
  const saving = queries.saveTracking(ctx, category, menuItem, {
    categoryId: category,
    expectedVersion: 0,
    clientRequestId: crypto.randomUUID(),
    mode: 'CREATE',
    unit: 'BOTTLE',
  });
  const rejected = expect(saving).rejects.toMatchObject({ status: 500 });
  http.expectOne((r) => r.method === 'PUT').flush({}, { status: 500, statusText: 'Uncertain' });
  await tick();
  http
    .expectOne((r) => r.method === 'GET')
    .flush({ data: { menuItemId: menuItem, version: 1, stockItem: stockItem() } });
  await rejected;
  expect(requests).toHaveLength(2);
});
it('fresh Inventory observers remount with zero HTTP GETs', async () => {
  const list = await loadedItems();
  const detail = await loadedDetail();
  list.destroy();
  detail.destroy();
  requests = [];
  const nextList = new InfiniteQueryObserver(client, queries.items(ctx, true));
  const nextDetail = new QueryObserver(client, queries.item(ctx, stockItem().id, true));
  cleanups.push(
    nextList.subscribe(() => {}),
    nextDetail.subscribe(() => {}),
  );
  await tick();
  expect(nextList.getCurrentResult().data?.pages[0].items).toEqual([stockItem()]);
  expect(requests).toEqual([]);
});
it('keeps same-context data visible during background revalidation', async () => {
  const list = await loadedItems();
  const fetching = list.refetch();
  expect(list.getCurrentResult().isFetching).toBe(true);
  expect(list.getCurrentResult().isPending).toBe(false);
  expect(list.getCurrentResult().data?.pages[0].items).toEqual([stockItem()]);
  http.expectOne((r) => r.method === 'GET').flush({ items: [stockItem({ version: 2 })] });
  await fetching;
});
it('merges a confirmed immutable movement into partial newest-first history but revalidates item/list', async () => {
  await loadedItems();
  await loadedDetail();
  const history = new InfiniteQueryObserver(client, queries.history(ctx, stockItem().id, true));
  cleanups.push(history.subscribe(() => {}));
  http
    .expectOne((r) => r.url.endsWith('/movements'))
    .flush({ items: [stockMovement()], nextCursor: 'older' });
  await tick();
  requests = [];
  const incoming = stockMovement({
    id: rid(90),
    createdAt: '2026-10-28T10:00:00.000Z',
    resultingBalanceMilli: 14000,
  });
  const moving = queries.movement(ctx, stockItem().id, {
    type: 'RECEIPT',
    quantity: '2',
    clientRequestId: crypto.randomUUID(),
  });
  expect(history.getCurrentResult().data?.pages[0].items).toEqual([stockMovement()]);
  http.expectOne((r) => r.method === 'POST').flush({ data: incoming });
  await tick();
  expect(history.getCurrentResult().data?.pages[0].items).toEqual([incoming, stockMovement()]);
  http
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/inventory/items'))
    .flush({ items: [stockItem({ balanceMilli: 14000, version: 2 })] });
  http
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/items/' + stockItem().id))
    .flush({ data: stockItem({ balanceMilli: 14000, version: 2 }) });
  await moving;
  expect(requests).toHaveLength(3); // POST + necessary current list/detail, no history GET.
  expect(history.getCurrentResult().data?.pages[0].nextCursor).toBe('older');
});
it('409 does not apply the proposal and still revalidates canonical list/detail', async () => {
  await loadedItems();
  await loadedDetail();
  requests = [];
  const saving = queries.save(ctx, stockItem().id, {
    expectedVersion: 1,
    name: 'Rejected proposal',
  });
  const rejected = expect(saving).rejects.toMatchObject({ status: 409 });
  http.expectOne((r) => r.method === 'PATCH').flush({}, { status: 409, statusText: 'Conflict' });
  await tick();
  http
    .expectOne((r) => r.url.endsWith('/inventory/items'))
    .flush({ items: [stockItem({ version: 3 })] });
  http
    .expectOne((r) => r.url.endsWith('/items/' + stockItem().id))
    .flush({ data: stockItem({ version: 3 }) });
  await rejected;
  expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toEqual(
    stockItem({ version: 3 }),
  );
});
it('updates only the same org/outlet/actor/revision, including compatible configuration aliases', async () => {
  const foreign = [
    { ...ctx, org: 'other' },
    { ...ctx, outlet: rid(9) },
    { ...ctx, user: 'other' },
    { ...ctx, revision: 99 },
  ];
  for (const scope of foreign) {
    client.setQueryData(inventoryKeys.items(scope), pages([stockItem()]));
    client.setQueryData(inventoryKeys.item(scope, stockItem().id), stockItem());
  }
  const configuration = { ...ctx, identity: `configuration:${ctx.outlet}` };
  client.setQueryData(inventoryKeys.items(configuration), pages([stockItem()]));
  const canonical = stockItem({ name: 'Confirmed', version: 2 });
  const saving = queries.save(ctx, canonical.id, { expectedVersion: 1, name: 'Confirmed' });
  http.expectOne((r) => r.method === 'PATCH').flush({ data: canonical });
  await saving;
  for (const scope of foreign) {
    expect(client.getQueryData(inventoryKeys.item(scope, stockItem().id))).toEqual(stockItem());
    expect(client.getQueryData(inventoryKeys.items(scope))).toEqual(pages([stockItem()]));
  }
  expect(
    client.getQueryData<CursorData<StockItemResponseData>>(inventoryKeys.items(configuration))
      ?.pages[0].items,
  ).toEqual([canonical]);
});
it('does not let an older confirmed version replace a newer cached version', async () => {
  client.setQueryData(inventoryKeys.items(ctx), pages([stockItem({ version: 4 })]));
  client.setQueryData(inventoryKeys.item(ctx, stockItem().id), stockItem({ version: 4 }));
  const saving = queries.save(ctx, stockItem().id, { expectedVersion: 1, name: 'Older' });
  http
    .expectOne((r) => r.method === 'PATCH')
    .flush({ data: stockItem({ name: 'Older', version: 2 }) });
  await saving;
  expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toEqual(
    stockItem({ version: 4 }),
  );
});
it.each(['org', 'user', 'revision', 'outlet', 'identity'])(
  'rejects late confirmed %s completions before cache mutation',
  async (field) => {
    const saving = queries.save(ctx, stockItem().id, { expectedVersion: 1, name: 'Late' });
    const rejected = expect(saving).rejects.toMatchObject({ status: 409 });
    const request = http.expectOne((r) => r.method === 'PATCH');
    if (field === 'org') org.set('other');
    if (field === 'user') user.set('other');
    if (field === 'revision') revision.set(99);
    if (field === 'outlet') outlet.set(rid(99));
    if (field === 'identity') identity.set('new');
    request.flush({ data: stockItem({ version: 2 }) });
    await rejected;
    expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toBeUndefined();
  },
);
it('configuration descriptive PATCH updates the canonical detail and loaded list with no immediate GET', async () => {
  const config = TestBed.inject(RestaurantsQueries),
    api = TestBed.inject(RestaurantsApi),
    context = { outletId: ctx.outlet };
  const old = row('station'),
    canonical = { ...old, name: 'New station name', version: 2 };
  const list = new InfiniteQueryObserver(client, config.list('station', context));
  const detail = new QueryObserver(client, config.detail('station', context, old.id));
  cleanups.push(
    list.subscribe(() => {}),
    detail.subscribe(() => {}),
  );
  http.expectOne((r) => r.url.endsWith('/preparation-stations')).flush({ items: [old] });
  http.expectOne((r) => r.url.endsWith('/preparation-stations/' + old.id)).flush({ data: old });
  await tick();
  requests = [];
  const mutation = api.save(
    ctx.org,
    'station',
    context,
    { name: canonical.name, expectedVersion: 1 },
    old.id,
  );
  http.expectOne((r) => r.method === 'PATCH').flush({ data: canonical });
  const result = await mutation;
  await config.confirmed(ctx.org, 'station', context, result.data, false, {
    user: ctx.user,
    revision: ctx.revision,
  });
  expect(requests).toHaveLength(1);
  expect(detail.getCurrentResult().data).toEqual(canonical);
  expect(list.getCurrentResult().data?.pages[0].items).toEqual([canonical]);
});
it('configuration cache writes reject stale actor/revision and isolate parents/organizations', async () => {
  const config = TestBed.inject(RestaurantsQueries),
    context = { outletId: ctx.outlet };
  const old = row('station'),
    canonical = { ...old, name: 'Confirmed', version: 2 };
  const foreignKeys = [
    restaurantKeys.collection('other', 'station', context),
    restaurantKeys.collection(ctx.org, 'station', { outletId: rid(99) }),
  ];
  foreignKeys.forEach((key) => client.setQueryData(key, pages([old])));
  await config.confirmed(ctx.org, 'station', context, canonical, false, {
    user: 'other',
    revision: ctx.revision,
  });
  expect(
    client.getQueryData(restaurantKeys.detail(ctx.org, 'station', context, old.id)),
  ).toBeUndefined();
  await config.confirmed(ctx.org, 'station', context, canonical, false, {
    user: ctx.user,
    revision: ctx.revision,
  });
  foreignKeys.forEach((key) => expect(client.getQueryData(key)).toEqual(pages([old])));
});
it('fences an older in-flight detail completion after applying the confirmed response', async () => {
  const detail = await loadedDetail();
  const oldRead = detail.refetch();
  const stale = http.expectOne((r) => r.method === 'GET');
  requests = [];
  const saving = queries.save(ctx, stockItem().id, { expectedVersion: 1, name: 'Confirmed' });
  const canonical = stockItem({ name: 'Confirmed', version: 2 });
  http.expectOne((r) => r.method === 'PATCH').flush({ data: canonical });
  await saving;
  await oldRead;
  // The HTTP request was already dispatched; cancelQueries fences its cache commit.
  stale.flush({ data: stockItem() });
  await tick();
  expect(detail.getCurrentResult().data).toEqual(canonical);
  expect(requests).toHaveLength(1);
});
it('uses the newer canonical collection row when a delayed response seeds a previously absent detail', async () => {
  const latest = stockItem({ version: 4, name: 'Latest' });
  client.setQueryData(inventoryKeys.items(ctx), pages([latest]));
  const saving = queries.save(ctx, stockItem().id, { expectedVersion: 1, name: 'Older' });
  http
    .expectOne((r) => r.method === 'PATCH')
    .flush({ data: stockItem({ version: 2, name: 'Older' }) });
  await saving;
  expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toEqual(latest);
});
it('does not duplicate an immutable movement on idempotent confirmed replay', async () => {
  const history = new InfiniteQueryObserver(client, queries.history(ctx, stockItem().id, true));
  cleanups.push(history.subscribe(() => {}));
  http
    .expectOne((r) => r.method === 'GET')
    .flush({ items: [stockMovement()], nextCursor: 'older' });
  await tick();
  requests = [];
  const moving = queries.movement(ctx, stockItem().id, {
    type: 'RECEIPT',
    quantity: '12',
    clientRequestId: crypto.randomUUID(),
  });
  http.expectOne((r) => r.method === 'POST').flush({ data: stockMovement() });
  await moving;
  expect(history.getCurrentResult().data?.pages[0].items).toEqual([stockMovement()]);
  expect(requests).toHaveLength(1);
});
it('reconciles history when an old replay falls outside an incomplete loaded range', async () => {
  const recent = stockMovement({ id: rid(90), createdAt: '2026-10-28T10:00:00.000Z' });
  const history = new InfiniteQueryObserver(client, queries.history(ctx, stockItem().id, true));
  cleanups.push(history.subscribe(() => {}));
  http.expectOne((r) => r.method === 'GET').flush({ items: [recent], nextCursor: 'older' });
  await tick();
  requests = [];
  const moving = queries.movement(ctx, stockItem().id, {
    type: 'RECEIPT',
    quantity: '12',
    clientRequestId: crypto.randomUUID(),
  });
  http.expectOne((r) => r.method === 'POST').flush({ data: stockMovement() });
  await tick();
  expect(history.getCurrentResult().data?.pages[0].items).toEqual([recent]);
  http
    .expectOne((r) => r.method === 'GET' && r.url.endsWith('/movements'))
    .flush({ items: [recent], nextCursor: 'older' });
  await moving;
  expect(requests).toHaveLength(2);
});
it('configuration changes invalidate only the Outlet Carte projection, without rereading unchanged Menu metadata', async () => {
  const config = TestBed.inject(RestaurantsQueries),
    context = { outletId: ctx.outlet, categoryId: rid(6) };
  const carte = restaurantKeys.carte(ctx.org, ctx.user, ctx.revision, ctx.outlet, rid(7));
  const otherOutlet = restaurantKeys.carte(ctx.org, ctx.user, ctx.revision, rid(99), rid(7));
  const otherOrg = restaurantKeys.carte('foreign', ctx.user, ctx.revision, ctx.outlet, rid(7));
  const menu = restaurantKeys.carteMenu(ctx.org, ctx.user, ctx.revision, ctx.outlet);
  [carte, otherOutlet, otherOrg, menu].forEach((key) => client.setQueryData(key, {}));
  await config.confirmed(ctx.org, 'item', context, row('item'), false, {
    user: ctx.user,
    revision: ctx.revision,
  });
  expect(client.getQueryState(carte)?.isInvalidated).toBe(true);
  [otherOutlet, otherOrg, menu].forEach((key) =>
    expect(client.getQueryState(key)?.isInvalidated).toBe(false),
  );
});
it('updates an equivalent loaded Kitchen station reference without changing its context metadata', async () => {
  const { kitchenKeys } = await import('./restaurant-preparation.queries');
  const key = kitchenKeys.stations(ctx);
  const old = row('station'),
    canonical = { ...old, name: 'Canonical station', version: 2 };
  client.setQueryData(key, {
    pages: [{ items: [old], contextKey: 'verified-kitchen-context' }],
    pageParams: [undefined],
  });
  await TestBed.inject(RestaurantsQueries).confirmed(
    ctx.org,
    'station',
    { outletId: ctx.outlet },
    canonical,
    false,
    { user: ctx.user, revision: ctx.revision },
  );
  expect(client.getQueryData(key)).toEqual({
    pages: [{ items: [canonical], contextKey: 'verified-kitchen-context' }],
    pageParams: [undefined],
  });
  expect(requests).toEqual([]);
});
it('confirmed Menu response updates a mounted operational Menu detail without a redundant GET', async () => {
  const config = TestBed.inject(RestaurantsQueries),
    key = restaurantKeys.carteMenu(ctx.org, ctx.user, ctx.revision, ctx.outlet);
  const old = row('menu'),
    canonical = { ...old, name: 'Updated Menu', version: 2 };
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => TestBed.inject(RestaurantsApi).get(ctx.org, 'menu', { outletId: ctx.outlet }),
    staleTime: 60_000,
  });
  cleanups.push(observer.subscribe(() => {}));
  http.expectOne((r) => r.method === 'GET').flush({ data: old });
  await tick();
  requests = [];
  await config.confirmed(ctx.org, 'menu', { outletId: ctx.outlet }, canonical, false, {
    user: ctx.user,
    revision: ctx.revision,
  });
  expect(observer.getCurrentResult().data).toEqual(canonical);
  expect(requests).toEqual([]);
});
it('does not let a previously unlinked in-flight tracking read restore older StockItem fields', async () => {
  const category = rid(6),
    menuItem = rid(8);
  const observer = new QueryObserver(client, queries.tracking(ctx, category, menuItem, true));
  cleanups.push(observer.subscribe(() => {}));
  const trackingRead = http.expectOne((r) => r.method === 'GET');
  const canonical = stockItem({ name: 'Confirmed latest', version: 2 });
  const saving = queries.save(ctx, canonical.id, { expectedVersion: 1, name: canonical.name });
  http.expectOne((r) => r.method === 'PATCH').flush({ data: canonical });
  await saving;
  trackingRead.flush({ data: { menuItemId: menuItem, version: 1, stockItem: stockItem() } });
  await tick();
  expect(observer.getCurrentResult().data?.stockItem).toEqual(canonical);
  expect(requests).toHaveLength(2); // Initial mapping GET + PATCH; no additional GET.
});
it('reconciles an ambiguous StockItem PATCH without inventing success or keeping a local proposal', async () => {
  await loadedItems();
  await loadedDetail();
  requests = [];
  const saving = queries.save(ctx, stockItem().id, {
    expectedVersion: 1,
    name: 'Uncertain proposal',
  });
  const rejected = expect(saving).rejects.toMatchObject({ status: 0 });
  http.expectOne((r) => r.method === 'PATCH').error(new ProgressEvent('error'));
  await tick();
  expect(client.getQueryData(inventoryKeys.item(ctx, stockItem().id))).toEqual(stockItem());
  http
    .expectOne((r) => r.url.endsWith('/inventory/items'))
    .flush({ items: [stockItem({ version: 2 })] });
  http
    .expectOne((r) => r.url.endsWith('/items/' + stockItem().id))
    .flush({ data: stockItem({ version: 2 }) });
  await rejected;
  expect(requests).toHaveLength(3);
});
