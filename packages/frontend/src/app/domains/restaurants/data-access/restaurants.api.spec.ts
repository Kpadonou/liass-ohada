import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthStore } from '../../identity/data-access/auth.store';
import { environment } from '../../../../environments/environment';
import { RestaurantsApi } from './restaurants.api';
import { restaurantPath, RestaurantKind } from './restaurants-model';
import { context, rid, row } from './restaurants.test-fixture';
const base = environment.apiBaseUrl.replace(/\/$/, '');
describe('RESTO-1C validated API contracts', () => {
  const scope = signal('org');
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
  it.each([
    'restaurant',
    'outlet',
    'area',
    'table',
    'station',
    'menu',
    'category',
    'item',
  ] as const)('validates %s response and exact immutable parent path', async (kind) => {
    const entity = row(kind);
    const promise = api.get('org', kind, context, entity.id);
    const r = http.expectOne(base + restaurantPath(kind, context, entity.id));
    r.flush({ data: entity });
    await expect(promise).resolves.toEqual(entity);
  });
  it.each(['outlet', 'area', 'table', 'station', 'category', 'item'] as const)(
    'paginates %s using the bounded backend envelope',
    async (kind) => {
      const promise = api.list('org', kind, context, 'cursor');
      const r = http.expectOne(
        (req) =>
          req.url === base + restaurantPath(kind, context) &&
          req.params.get('limit') === '50' &&
          req.params.get('cursor') === 'cursor',
      );
      r.flush({ items: [row(kind)], nextCursor: 'next' });
      await expect(promise).resolves.toMatchObject({ nextCursor: 'next' });
    },
  );
  it.each([
    'restaurant',
    'outlet',
    'area',
    'table',
    'station',
    'menu',
    'category',
    'item',
  ] as const)('preserves expectedVersion on %s PATCH', async (kind) => {
    const entity = row(kind);
    const promise = api.save(
      'org',
      kind,
      context,
      { name: 'Updated', expectedVersion: 1 },
      entity.id,
    );
    const r = http.expectOne(
      base +
        restaurantPath(
          kind,
          context,
          ['restaurant', 'menu'].includes(kind) ? undefined : entity.id,
        ),
    );
    expect(r.request.method).toBe('PATCH');
    expect(r.request.body).toEqual({ name: 'Updated', expectedVersion: 1 });
    r.flush({
      data: { ...entity, name: 'Updated', version: 2 },
      message: { code: 'SAVED', message: 'Saved safely.' },
    });
    await expect(promise).resolves.toMatchObject({ message: 'Saved safely.' });
  });
  it('creates table with optional capacity absent and sends no tenant or parent body fields', async () => {
    const promise = api.save('org', 'table', context, {
      clientRequestId: rid(99),
      name: 'Table 1',
      code: 't01',
    });
    const r = http.expectOne(base + restaurantPath('table', context));
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ clientRequestId: rid(99), name: 'Table 1', code: 'T01' });
    r.flush({ data: row('table') });
    await promise;
  });
  it('uses distinct deactivation and dedicated availability operations', async () => {
    const entity = row('item');
    let promise = api.deactivate('org', 'item', context, entity.id, 1);
    let r = http.expectOne(base + restaurantPath('item', context, entity.id) + '/deactivate');
    expect(r.request.body).toEqual({ expectedVersion: 1 });
    r.flush({ data: { ...entity, isActive: false, version: 2 } });
    await promise;
    const availability = api.availability('org', context, entity.id, 2, 'UNAVAILABLE');
    r = http.expectOne(base + restaurantPath('item', context, entity.id) + '/availability');
    expect(r.request.body).toEqual({ expectedVersion: 2, availability: 'UNAVAILABLE' });
    r.flush({ data: { ...entity, version: 3, availability: 'UNAVAILABLE' } });
    await availability;
  });
  it('accepts only opaque administrative QR response', async () => {
    const promise = api.qr('org', context, rid(4));
    http
      .expectOne(base + restaurantPath('table', context, rid(4)) + '/qr')
      .flush({ token: 'x'.repeat(43) });
    await expect(promise).resolves.toEqual({ token: 'x'.repeat(43) });
  });
  it('treats only explicit singleton-not-found as initialization and propagates access/network errors', async () => {
    let promise = api.get('org', 'restaurant');
    http
      .expectOne(base + '/restaurants/restaurant')
      .flush(
        { error: { code: 'RESTAURANTS_NOT_FOUND' } },
        { status: 404, statusText: 'Not Found' },
      );
    await expect(promise).resolves.toBeNull();
    const menuPromise = api.get('org', 'menu', context);
    http
      .expectOne(base + restaurantPath('menu', context))
      .flush(
        { error: { code: 'PRODUCT_ACCESS_REQUIRED' } },
        { status: 403, statusText: 'Forbidden' },
      );
    await expect(menuPromise).rejects.toBeInstanceOf(HttpErrorResponse);
  });
  it('rejects malformed public DTOs and stale workspace requests', async () => {
    const promise = api.get('org', 'restaurant');
    http
      .expectOne(base + '/restaurants/restaurant')
      .flush({ data: { ...row('restaurant'), PK: 'secret' } });
    await expect(promise).rejects.toThrow();
    scope.set('other');
    await expect(api.qr('org', context, rid(4))).rejects.toBeInstanceOf(HttpErrorResponse);
    http.expectNone(base + restaurantPath('table', context, rid(4)) + '/qr');
  });
});

describe('operational Carte transport safety', () => {
  const org = signal('org'),
    user = signal('user'),
    revision = signal(1);
  let api: RestaurantsApi, http: HttpTestingController;
  const ctx = { org: 'org', user: 'user', revision: 1, outlet: rid(2), menu: rid(7) };
  beforeEach(() => {
    org.set('org');
    user.set('user');
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
    api = TestBed.inject(RestaurantsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  it('requests one unified 100-row page with no category or search parameter', async () => {
    const promise = api.cartePage(ctx, 'next', new AbortController().signal);
    const request = http.expectOne((r) => r.url.endsWith('/menu/items'));
    expect(request.request.params.keys()).toEqual(['limit', 'cursor']);
    expect(request.request.params.get('limit')).toBe('100');
    request.flush({ outletId: ctx.outlet, menuId: ctx.menu, items: [] });
    await expect(promise).resolves.toMatchObject({ items: [] });
  });
  it('aborts the underlying HTTP request when the Query signal is cancelled', async () => {
    const controller = new AbortController();
    const promise = api.cartePage(ctx, undefined, controller.signal);
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    const request = http.expectOne((r) => r.url.endsWith('/menu/items'));
    controller.abort();
    expect(request.cancelled).toBe(true);
    await rejected;
  });
  it.each(['organization', 'principal', 'revision'])(
    'rejects late data after %s change',
    async (dimension) => {
      const promise = api.cartePage(ctx, undefined, new AbortController().signal);
      const rejected = expect(promise).rejects.toMatchObject({ status: 409 });
      const request = http.expectOne((r) => r.url.endsWith('/menu/items'));
      if (dimension === 'organization') org.set('other');
      if (dimension === 'principal') user.set('other');
      if (dimension === 'revision') revision.set(2);
      request.flush({ outletId: ctx.outlet, menuId: ctx.menu, items: [] });
      await rejected;
    },
  );
  it('rejects foreign outlet/Menu response ownership', async () => {
    const promise = api.cartePage(ctx, undefined, new AbortController().signal);
    const rejected = expect(promise).rejects.toThrow('Mismatched Carte');
    http
      .expectOne((r) => r.url.endsWith('/menu/items'))
      .flush({ outletId: rid(12), menuId: ctx.menu, items: [] });
    await rejected;
  });
});
