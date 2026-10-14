import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantsQueries, restaurantKeys } from './restaurants.queries';
import { floorFixture } from './service-floor.test-fixture';
import { rid } from './restaurants.test-fixture';
import { environment } from '../../../../environments/environment';
const scope = signal('org');
describe('validated Service Floor transport', () => {
  let api: RestaurantsApi, http: HttpTestingController;
  beforeEach(() => {
    scope.set('org');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { effectiveOrgId: scope } },
      ],
    });
    api = TestBed.inject(RestaurantsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('uses exact outlet URL, limit 100 and opaque cursor', async () => {
    const promise = api.serviceFloor('org', rid(2), 'opaque');
    const req = http.expectOne(
      (r) =>
        r.url.endsWith('/' + rid(2) + '/service-floor') &&
        r.params.get('limit') === '100' &&
        r.params.get('cursor') === 'opaque',
    );
    req.flush(floorFixture());
    expect(await promise).toEqual(floorFixture());
  });
  it('rejects malformed and foreign-outlet responses', async () => {
    for (const payload of [
      { outletId: rid(2), items: [{ state: 'CALL_WAITER' }] },
      { ...floorFixture(), outletId: rid(22) },
    ]) {
      const promise = api.serviceFloor('org', rid(2));
      const rejected = expect(promise).rejects.toBeInstanceOf(Error);
      http.expectOne((r) => r.url.endsWith('/service-floor')).flush(payload);
      await rejected;
    }
  });
  it('keeps stable command identity and never adds party size', async () => {
    const request = { clientRequestId: rid(30), tableId: rid(4), areaId: rid(3) };
    for (let i = 0; i < 2; i++) {
      const promise = api.openSession('org', rid(2), request);
      const rejected = expect(promise).rejects.toMatchObject({ status: 503 });
      const req = http.expectOne(
        environment.apiBaseUrl.replace(/\/$/, '') + '/restaurants/outlets/' + rid(2) + '/sessions',
      );
      expect(req.request.body).toEqual(request);
      req.flush({ message: 'Unavailable' }, { status: 503, statusText: 'Unavailable' });
      await rejected;
    }
  });
  it('rejects a stale workspace before issuing requests', async () => {
    scope.set('other');
    await expect(api.serviceFloor('org', rid(2))).rejects.toMatchObject({ status: 409 });
    http.expectNone((r) => r.url.includes('/service-floor'));
  });
});
describe('Service Floor cache and bounded empty-page consumption', () => {
  let client: QueryClient, q: RestaurantsQueries;
  const api = { serviceFloor: vi.fn() };
  beforeEach(() => {
    scope.set('org');
    api.serviceFloor.mockReset();
    client = new QueryClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { effectiveOrgId: scope } },
        { provide: RestaurantsApi, useValue: api },
        { provide: QueryClient, useValue: client },
      ],
    });
    q = TestBed.inject(RestaurantsQueries);
  });
  afterEach(() => {
    client.clear();
    TestBed.resetTestingModule();
  });
  it('automatically skips empty cursor pages and completes only at the cursor end', async () => {
    api.serviceFloor
      .mockResolvedValueOnce({ outletId: rid(2), items: [], nextCursor: 'next' })
      .mockResolvedValueOnce(floorFixture());
    const data = await client.fetchInfiniteQuery(q.serviceFloor(rid(2)));
    expect(api.serviceFloor).toHaveBeenNthCalledWith(2, 'org', rid(2), 'next');
    expect(data.pages[0].items).toHaveLength(3);
    expect(data.pages[0].nextCursor).toBeUndefined();
  });
  it('leaves nonempty partial pages available for explicit pagination', async () => {
    api.serviceFloor.mockResolvedValue({ ...floorFixture(), nextCursor: 'next' });
    const data = await client.fetchInfiniteQuery(q.serviceFloor(rid(2)));
    expect(data.pages[0].nextCursor).toBe('next');
    expect(api.serviceFloor).toHaveBeenCalledTimes(1);
  });
  it('stops cursor cycles and bounded empty-page chains', async () => {
    api.serviceFloor.mockResolvedValue({ outletId: rid(2), items: [], nextCursor: 'same' });
    await expect(client.fetchInfiniteQuery(q.serviceFloor(rid(2)))).rejects.toThrow('pagination');
    expect(api.serviceFloor).toHaveBeenCalledTimes(2);
    client.clear();
    api.serviceFloor.mockReset();
    let n = 0;
    api.serviceFloor.mockImplementation(async () => ({
      outletId: rid(2),
      items: [],
      nextCursor: String(++n),
    }));
    await expect(client.fetchInfiniteQuery(q.serviceFloor(rid(2)))).rejects.toThrow('pagination');
    expect(api.serviceFloor).toHaveBeenCalledTimes(8);
  });
  it('isolates organization/outlet keys and invalidates only the captured floor', async () => {
    const first = q.serviceFloor(rid(2)).queryKey;
    scope.set('other');
    expect(q.serviceFloor(rid(2)).queryKey).not.toEqual(first);
    expect(q.serviceFloor(rid(3)).queryKey).not.toEqual(q.serviceFloor(rid(2)).queryKey);
    const spy = vi.spyOn(client, 'invalidateQueries');
    await q.floorChanged('org', rid(2));
    expect(spy).toHaveBeenCalledWith({
      queryKey: restaurantKeys.floor('org', rid(2)),
      exact: true,
    });
  });
  it('preserves valid pagination during refetch and refreshes at minute level', async () => {
    const options = q.serviceFloor(rid(2));
    api.serviceFloor
      .mockResolvedValueOnce({ ...floorFixture(), nextCursor: 'next' })
      .mockResolvedValueOnce(floorFixture());
    client.setQueryData(options.queryKey, {
      pages: [{ ...floorFixture(), nextCursor: 'next' }, floorFixture()],
      pageParams: [undefined, 'next'],
    });
    await expect(client.fetchInfiniteQuery({ ...options, staleTime: 0 })).resolves.toBeDefined();
    expect(options.refetchInterval).toBe(60000);
    expect(options.refetchIntervalInBackground).toBe(false);
  });
});
