import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';
import {
  HttpErrorResponse,
  HttpInterceptorFn,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { fetchAuthSession } from 'aws-amplify/auth';
import { inject as testContext } from 'vitest';
import { AuthStore } from '../../identity/data-access/auth.store';
import { authInterceptor } from '../../../core/http/auth.interceptor';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { ProductAccessQueries } from '../../../core/product-access/product-access.queries';
import { productAccessGuard } from '../../../core/product-access/product-access.guard';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ShellProductNavigation } from '../../../core/navigation/product-navigation';
import { SalesCapabilities } from '../../sales/data-access/sales-capabilities';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantsQueries } from './restaurants.queries';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import {
  RestaurantContext,
  RestaurantEntities,
  RestaurantKind,
  restaurantPath,
} from './restaurants-model';
import {
  RestaurantEditorComponent,
  RestaurantEditorData,
} from '../feature/restaurant-editor.component';
import { RestaurantsWorkspacePage } from '../feature/restaurants-workspace.page';
import { restaurantErrorKey } from '../utils/restaurant-errors';
import { parseMinorInput, restaurantPrice } from '../utils/restaurant-money';

declare module 'vitest' {
  interface ProvidedContext {
    restaurantsUrl: string;
  }
}
const rid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const org = signal<string | null>('org-a'),
  role = signal('OWNER');
let api: RestaurantsApi,
  queries: RestaurantsQueries,
  client: QueryClient,
  sequence = 0;
let root: RestaurantEntities['restaurant'], outlet: RestaurantEntities['outlet'];
let areas: RestaurantEntities['area'][],
  tables: RestaurantEntities['table'][],
  stations: RestaurantEntities['station'][],
  categories: RestaurantEntities['category'][],
  items: RestaurantEntities['item'][];
const url = () => testContext('restaurantsUrl');
const site = (): RestaurantContext => ({ outletId: outlet.id });
const request = (name: string) => ({ name, clientRequestId: rid(++sequence) });
const close = { close: vi.fn() };
const t = {
  RESTAURANTS: {
    UI: {
      NAME: 'Name',
      SAVE: 'Save',
      CONFLICT_REVIEW: 'Review configuration before retrying',
      ERRORS: {
        CONFLICT: 'Configuration changed or duplicate table code: review and retry.',
        NETWORK: 'Check your connection',
      },
    },
  },
};
const redirect: HttpInterceptorFn = (req, next) =>
  next(req.clone({ url: url() + new URL(req.url).pathname + new URL(req.url).search }));
async function raw(
  path: string,
  method = 'GET',
  body?: unknown,
  tenant: string | null = org(),
  user = role().toLowerCase(),
) {
  const response = await fetch(url() + path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      ...(tenant ? { 'x-org-id': tenant } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function createFixture() {
  root = (await api.save('org-a', 'restaurant', {}, request('Héritage Bistro'))).data;
  outlet = (await api.save('org-a', 'outlet', {}, request('Agla'))).data;
  areas = [];
  tables = [];
  stations = [];
  categories = [];
  items = [];
  for (const name of ['Main Room', 'Terrace'])
    areas.push((await api.save('org-a', 'area', site(), request(name))).data);
  for (let i = 0; i < 4; i++)
    tables.push(
      (
        await api.save(
          'org-a',
          'table',
          { ...site(), areaId: areas[i % 2].id },
          { ...request(`T0${i + 1}`), code: `T0${i + 1}`, capacity: 4 },
        )
      ).data,
    );
  for (const name of ['KITCHEN', 'BAR'])
    stations.push((await api.save('org-a', 'station', site(), request(name))).data);
  await api.save('org-a', 'menu', site(), { ...request('Agla Menu'), currency: 'XOF' });
  for (const name of ['Main Dishes', 'Drinks', 'Desserts'])
    categories.push((await api.save('org-a', 'category', site(), request(name))).data);
  const fixture = [
    ['Grilled Chicken', 0, 0, 5000, false],
    ['Fried Plantain', 0, 0, 1500, false],
    ['Bottled Water', 1, 1, 500, true],
    ['Beer', 1, 1, 1000, true],
    ['Chocolate Cake', 2, undefined, 2000, false],
  ] as const;
  for (const [name, category, station, amount, reorder] of fixture)
    items.push(
      (
        await api.save(
          'org-a',
          'item',
          { ...site(), categoryId: categories[category].id },
          {
            ...request(name),
            price: { amountMinor: parseMinorInput(String(amount), 'XOF'), currency: 'XOF' },
            guestReorderEnabled: reorder,
            ...(station === undefined ? {} : { preparationStationId: stations[station].id }),
          },
        )
      ).data,
    );
}
function selectOrganization(id: string) {
  org.set(id);
  localStorage.setItem('liass-ohada.activeOrgId', id);
}
function configure(mode = 'menu', data?: RestaurantEditorData) {
  TestBed.configureTestingModule({
    imports: [
      RestaurantsWorkspacePage,
      RestaurantEditorComponent,
      TranslocoTestingModule.forRoot({
        langs: { en: t },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      }),
    ],
    providers: [
      provideRouter([]),
      provideHttpClient(withFetch(), withInterceptors([authInterceptor, redirect])),
      { provide: QueryClient, useValue: client },
      {
        provide: AuthStore,
        useValue: {
          effectiveOrgId: org,
          currentUserId: () => 'integration-user',
          contextRevision: org,
          invalidateSessionContext: vi.fn(),
          activeWorkspaceOrgId: org,
          activeWorkspaceType: () => 'COMPANY',
          activeWorkspace: () => ({
            orgId: org(),
            productRoles: { RESTAURANTS: role() },
            accessSource: 'DIRECT',
          }),
          isAuthenticated: () => true,
          workspacesLoaded: () => true,
          handleAccountingAuthorizationFailure: vi.fn().mockResolvedValue(false),
        },
      },
      { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data: { restaurantPage: mode, restaurantSection: 'restaurant' } } },
      },
      {
        provide: MAT_DIALOG_DATA,
        useValue: data ?? { org: 'org-a', kind: 'restaurant', context: {} },
      },
      { provide: MatDialogRef, useValue: close },
      { provide: SalesCapabilities, useValue: { canRead: () => false } },
    ],
  });
  api = TestBed.inject(RestaurantsApi);
  queries = TestBed.inject(RestaurantsQueries);
}
async function page(mode = 'menu') {
  TestBed.inject(ActivatedRoute).snapshot.data['restaurantPage'] = mode;
  const fixture = TestBed.createComponent(RestaurantsWorkspacePage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.root.isSuccess()).toBe(true);
  });
  return fixture;
}
beforeEach(async () => {
  selectOrganization('org-a');
  role.set('OWNER');
  sequence = 0;
  close.close.mockReset();
  await raw('/__test/reset', 'POST');
  vi.mocked(fetchAuthSession).mockImplementation(
    async () => ({ tokens: { accessToken: { toString: () => role().toLowerCase() } } }) as never,
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  configure();
}, 30000);
afterEach(() => {
  client.clear();
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
});

describe('RESTO-1D real Angular HTTP → production handlers/services/repository → memory DynamoDB', () => {
  it('creates the established setup/menu fixture, renders it and refreshes after lifecycle/availability changes', async () => {
    await createFixture();
    const f = await page();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.items.isSuccess()).toBe(true);
    });
    expect(f.nativeElement.textContent).toContain('Agla Menu');
    for (const category of categories) {
      f.componentInstance.selectCategory(category.id);
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.items.isSuccess()).toBe(true);
      });
      for (const item of items.filter((item) => item.categoryId === category.id)) {
        expect(f.nativeElement.textContent).toContain(item.name);
        expect(f.nativeElement.textContent).toContain(
          restaurantPrice(item.price.amountMinor, 'XOF', 'en'),
        );
      }
    }
    expect(items.map((item) => item.guestReorderEnabled)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(items.slice(0, 4).map((item) => item.preparationStationId)).toEqual([
      stations[0].id,
      stations[0].id,
      stations[1].id,
      stations[1].id,
    ]);
    f.componentInstance.selectCategory(categories[1].id);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.items.isSuccess()).toBe(true);
    });
    await f.componentInstance.toggleAvailability(items[3]);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(
        f.componentInstance.items.data()?.pages[0].items.find((item) => item.id === items[3].id)
          ?.availability,
      ).toBe('UNAVAILABLE');
    });
    const changed = await api.save(
      'org-a',
      'restaurant',
      {},
      { name: 'Héritage Bistro', guestOrderingPolicy: 'DIRECT', expectedVersion: root.version },
      root.id,
    );
    await queries.changed('org-a', 'restaurant');
    await vi.waitFor(() =>
      expect(f.componentInstance.root.data()?.guestOrderingPolicy).toBe('DIRECT'),
    );
    expect(changed.data.version).toBe(2);
    await api.deactivate(
      'org-a',
      'item',
      { ...site(), categoryId: categories[1].id },
      items[3].id,
      2,
    );
    await queries.changed('org-a', 'item', { ...site(), categoryId: categories[1].id });
    await vi.waitFor(() =>
      expect(
        f.componentInstance.items.data()?.pages[0].items.find((item) => item.id === items[3].id)
          ?.isActive,
      ).toBe(false),
    );
    expect(
      (await api.get('org-a', 'item', { ...site(), categoryId: categories[1].id }, items[3].id))
        ?.guestReorderEnabled,
    ).toBe(true);
    f.destroy();
    const setup = await page('setup');
    setup.componentInstance.section.set('table');
    for (const area of areas) {
      setup.componentInstance.selectArea(area.id);
      await vi.waitFor(() => {
        setup.detectChanges();
        expect(setup.componentInstance.tables.isSuccess()).toBe(true);
      });
      for (const table of tables.filter((table) => table.serviceAreaId === area.id))
        expect(setup.nativeElement.textContent).toContain(table.code);
    }
    expect(setup.nativeElement.textContent).not.toContain(outlet.id);
    const stats = await raw('/__test/stats');
    expect(stats.body.scans).toBe(0);
    expect(stats.body.reads).toBeGreaterThan(0);
    expect(stats.body.queries).toBeGreaterThan(0);
  }, 30000);
  it.each(['OWNER', 'MANAGER', 'WAITER', 'CASHIER', 'KITCHEN'])(
    '%s has consistent rendered management controls and authoritative mutation/QR access',
    async (selected) => {
      await createFixture();
      role.set(selected);
      const f = await page('setup');
      f.componentInstance.section.set('outlet');
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.locations.isSuccess()).toBe(true);
      });
      const manage = ['OWNER', 'MANAGER'].includes(selected);
      expect(TestBed.inject(RestaurantsCapabilities).canManageSetup()).toBe(manage);
      expect(f.nativeElement.querySelector('[aria-haspopup="menu"]') !== null).toBe(manage);
      const input = { expectedVersion: 1, name: 'Agla' };
      if (manage) {
        expect((await api.save('org-a', 'outlet', {}, input, outlet.id)).data.version).toBe(2);
        expect(
          (await api.qr('org-a', { ...site(), areaId: areas[0].id }, tables[0].id)).token,
        ).toMatch(/^[A-Za-z0-9_-]{43}$/);
      } else {
        await expect(api.save('org-a', 'outlet', {}, input, outlet.id)).rejects.toMatchObject({
          status: 403,
        });
        await expect(
          api.qr('org-a', { ...site(), areaId: areas[0].id }, tables[0].id),
        ).rejects.toMatchObject({ status: 403 });
      }
      expect((await api.list('org-a', 'category', site())).items).toHaveLength(3);
    },
    20000,
  );
  it('uses real ProductAccess for route denial, product switcher visibility and backend denial', async () => {
    selectOrganization('org-no-product');
    const access = TestBed.inject(ProductAccessQueries);
    await client.fetchQuery(access.list());
    const route = new ActivatedRouteSnapshot();
    route.data = { productCode: 'RESTAURANTS' };
    const result = await TestBed.runInInjectionContext(() =>
      productAccessGuard(route, {} as never),
    );
    expect(TestBed.inject(Router).serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe(
      '/dashboard',
    );
    const navigation = TestBed.inject(ShellProductNavigation);
    await vi.waitFor(() =>
      expect(TestBed.inject(ProductAccessState).availability('RESTAURANTS')).toBe('UNAVAILABLE'),
    );
    expect(navigation.products()).toEqual([]);
    await expect(api.get('org-no-product', 'restaurant')).rejects.toMatchObject({ status: 403 });
    selectOrganization('org-a');
    await client.fetchQuery(access.list());
    expect(await TestBed.runInInjectionContext(() => productAccessGuard(route, {} as never))).toBe(
      true,
    );
  });
  it('rejects missing auth/tenant, wrong membership and foreign IDs; body/query cannot choose tenant', async () => {
    await createFixture();
    expect((await raw('/restaurants/restaurant', 'GET', undefined, null)).status).toBe(400);
    expect(
      (await raw('/restaurants/restaurant', 'GET', undefined, 'org-a', 'invalid')).status,
    ).toBe(401);
    expect((await raw('/restaurants/restaurant', 'GET', undefined, 'foreign')).status).toBe(403);
    const forged = await raw('/restaurants/restaurant?orgId=org-b', 'PATCH', {
      name: 'Héritage Bistro',
      expectedVersion: 1,
      orgId: 'org-b',
      userId: 'manager',
    });
    expect(forged.status).toBe(200);
    selectOrganization('org-b');
    expect(await api.get('org-b', 'restaurant')).toBeNull();
    await expect(api.get('org-b', 'outlet', {}, outlet.id)).rejects.toMatchObject({ status: 404 });
    await expect(api.get('org-a', 'restaurant')).rejects.toMatchObject({ status: 409 });
  });
  it('preserves create intent across retries and keeps singleton/table QR mappings unique', async () => {
    const r = request('Héritage Bistro');
    root = (await api.save('org-a', 'restaurant', {}, r)).data;
    expect((await api.save('org-a', 'restaurant', {}, r)).data.id).toBe(root.id);
    await expect(
      api.save('org-a', 'restaurant', {}, { ...r, name: 'Changed' }),
    ).rejects.toMatchObject({ status: 409 });
    outlet = (await api.save('org-a', 'outlet', {}, request('Agla'))).data;
    const m = { ...request('Agla Menu'), currency: 'XOF' };
    const menu = (await api.save('org-a', 'menu', site(), m)).data;
    expect((await api.save('org-a', 'menu', site(), m)).data.id).toBe(menu.id);
    await expect(
      api.save('org-a', 'menu', site(), { ...m, name: 'Changed' }),
    ).rejects.toMatchObject({ status: 409 });
    const area = (await api.save('org-a', 'area', site(), request('Main Room'))).data;
    const ctx = { ...site(), areaId: area.id };
    const tableInput = { ...request('T01'), code: 'T01' };
    const table = (await api.save('org-a', 'table', ctx, tableInput)).data;
    const token = await api.qr('org-a', ctx, table.id);
    const before = await raw('/__test/stats');
    expect((await api.save('org-a', 'table', ctx, tableInput)).data.id).toBe(table.id);
    expect(await api.qr('org-a', ctx, table.id)).toEqual(token);
    expect((await raw('/__test/stats')).body.rows).toBe(before.body.rows);
    await expect(
      api.save('org-a', 'table', ctx, { ...tableInput, name: 'Changed' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await raw('/restaurants/public/qr/' + token.token)).status).toBe(404);
  });
  it('retries a form create after a lost commit response with the same logical identity', async () => {
    const form = TestBed.createComponent(RestaurantEditorComponent);
    form.detectChanges();
    await vi.waitFor(() =>
      expect(TestBed.inject(ProductAccessState).availability('RESTAURANTS')).toBe('AVAILABLE'),
    );
    form.componentInstance.form.controls.name.setValue('Héritage Bistro');
    await raw('/__test/fault?kind=network-after-commit', 'POST');
    await form.componentInstance.submit();
    expect(close.close).not.toHaveBeenCalled();
    expect(form.componentInstance.error()).toBeTruthy();
    const persisted = await api.get('org-a', 'restaurant');
    const before = await raw('/__test/stats');
    await form.componentInstance.submit();
    expect(close.close).toHaveBeenCalledWith(expect.objectContaining({ id: persisted!.id }));
    expect((await raw('/__test/stats')).body.rows).toBe(before.body.rows);
  });
  it('maps duplicate code and stale version through a real form, refreshing for an explicit retry', async () => {
    await createFixture();
    const ctx = { ...site(), areaId: areas[0].id };
    try {
      await api.save('org-a', 'table', ctx, { ...request('Duplicate'), code: 'T01' });
      throw new Error('Expected conflict');
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
      expect(restaurantErrorKey(error)).toBe('RESTAURANTS.UI.ERRORS.CONFLICT');
    }
    expect((await api.get('org-a', 'table', ctx, tables[0].id))?.name).toBe('T01');
    TestBed.inject(MAT_DIALOG_DATA).kind = 'table';
    Object.assign(TestBed.inject(MAT_DIALOG_DATA), { context: ctx, entity: tables[0] });
    const f = TestBed.createComponent(RestaurantEditorComponent);
    f.detectChanges();
    await vi.waitFor(() =>
      expect(TestBed.inject(ProductAccessState).availability('RESTAURANTS')).toBe('AVAILABLE'),
    );
    f.componentInstance.form.controls.capacity.setValue('6');
    await api.save(
      'org-a',
      'table',
      ctx,
      { expectedVersion: 1, name: 'Updated elsewhere' },
      tables[0].id,
    );
    await f.componentInstance.submit();
    f.detectChanges();
    expect(f.componentInstance.conflict()).toBe(true);
    expect(close.close).not.toHaveBeenCalled();
    await f.componentInstance.refreshConflict();
    expect(f.componentInstance.version()).toBe(2);
    expect(f.componentInstance.form.controls.capacity.value).toBe('6');
    await f.componentInstance.submit();
    expect(close.close).toHaveBeenCalled();
    expect((await api.get('org-a', 'table', ctx, tables[0].id))?.version).toBe(3);
    expect((await api.get('org-a', 'table', ctx, tables[0].id))?.name).toBe('Updated elsewhere');
  }, 20000);
  it('enforces station outlet/activity and exact money persistence with safe bounds', async () => {
    await createFixture();
    const ctx = { ...site(), categoryId: categories[1].id };
    for (const text of ['500', '1 000', '1 500', '5 000']) {
      const current = await api.get('org-a', 'item', ctx, items[3].id);
      Object.assign(TestBed.inject(MAT_DIALOG_DATA), {
        kind: 'item',
        entity: current,
        context: ctx,
        currency: 'XOF',
      });
      const form = TestBed.createComponent(RestaurantEditorComponent);
      form.detectChanges();
      await vi.waitFor(() =>
        expect(TestBed.inject(ProductAccessState).availability('RESTAURANTS')).toBe('AVAILABLE'),
      );
      form.componentInstance.form.controls.price.setValue(text);
      await form.componentInstance.submit();
      expect((await api.get('org-a', 'item', ctx, items[3].id))?.price).toEqual({
        amountMinor: parseMinorInput(text, 'XOF'),
        currency: 'XOF',
      });
      form.destroy();
    }
    const other = (await api.save('org-a', 'outlet', {}, request('Integrity check location'))).data;
    const foreign = (
      await api.save('org-a', 'station', { outletId: other.id }, request('Integrity check station'))
    ).data;
    let current = await api.get('org-a', 'item', ctx, items[3].id);
    for (const station of [rid(900), foreign.id])
      await expect(
        api.save(
          'org-a',
          'item',
          ctx,
          { expectedVersion: current!.version, preparationStationId: station },
          items[3].id,
        ),
      ).rejects.toMatchObject({ status: 404 });
    await api.deactivate('org-a', 'station', site(), stations[1].id, 1);
    await expect(
      api.save(
        'org-a',
        'item',
        ctx,
        { expectedVersion: current!.version, preparationStationId: stations[1].id },
        items[3].id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    current = await api.get('org-a', 'item', ctx, items[3].id);
    expect(current?.preparationStationId).toBe(stations[1].id);
    expect(() => parseMinorInput('-1', 'XOF')).toThrow();
    expect(() => parseMinorInput('9007199254740992', 'XOF')).toThrow();
    const max = Number.MAX_SAFE_INTEGER;
    await api.save(
      'org-a',
      'item',
      ctx,
      {
        expectedVersion: current!.version,
        price: { amountMinor: max, currency: 'XOF' },
        preparationStationId: null,
      },
      items[3].id,
    );
    expect((await api.get('org-a', 'item', ctx, items[3].id))?.price.amountMinor).toBe(max);
    expect(
      (
        await raw(restaurantPath('item', ctx, items[3].id), 'PATCH', {
          expectedVersion: 99,
          price: { amountMinor: -1, currency: 'XOF' },
        })
      ).status,
    ).toBe(400);
  }, 20000);
  it('uses backend cursors with frontend pagination and refuses other tenant/collection cursors', async () => {
    await createFixture();
    for (let i = 0; i < 49; i++)
      await api.save('org-a', 'station', site(), request(`Pagination ${i}`));
    const first = await api.list('org-a', 'station', site());
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const last = await api.list('org-a', 'station', site(), first.nextCursor);
    expect(last.items).toHaveLength(1);
    expect(new Set([...first.items, ...last.items].map((row) => row.id)).size).toBe(51);
    await expect(api.list('org-a', 'area', site(), first.nextCursor)).rejects.toMatchObject({
      status: 400,
    });
    selectOrganization('org-b');
    await api.save('org-b', 'restaurant', {}, request('Cursor isolation check'));
    const other = (await api.save('org-b', 'outlet', {}, request('Cursor isolation location')))
      .data;
    await expect(
      api.list('org-b', 'station', { outletId: other.id }, first.nextCursor),
    ).rejects.toMatchObject({ status: 400 });
    selectOrganization('org-a');
    const f = await page('setup');
    f.componentInstance.section.set('station');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.stations.isSuccess()).toBe(true);
    });
    await f.componentInstance.stations.fetchNextPage();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.stationRows()).toHaveLength(51);
    });
  }, 30000);
  it('switches rendered tenant data without A data leaking into B, including late A invalidation', async () => {
    await createFixture();
    const f = await page();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.items.isSuccess()).toBe(true);
    });
    selectOrganization('org-b');
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Grilled Chicken');
    expect(f.nativeElement.textContent).not.toContain('Agla Menu');
    await queries.changed('org-a', 'item', { ...site(), categoryId: categories[0].id });
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.root.data()).toBeNull();
    });
    expect(f.componentInstance.outletId()).toBeNull();
    selectOrganization('org-a');
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Agla Menu');
    });
  });
  it('keeps empty, loading, transport failures and malformed HTTP responses distinct', async () => {
    const f = TestBed.createComponent(RestaurantsWorkspacePage);
    f.detectChanges();
    expect(f.componentInstance.root.isPending()).toBe(true);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.root.data()).toBeNull();
    });
    f.destroy();
    await createFixture();
    await raw('/__test/fault?kind=malformed', 'POST');
    try {
      await api.get('org-a', 'restaurant');
      throw new Error('Expected malformed DTO');
    } catch (error) {
      expect(restaurantErrorKey(error)).toBe('RESTAURANTS.UI.ERRORS.RESPONSE');
    }
    await raw('/__test/fault?kind=network', 'POST');
    try {
      await api.get('org-a', 'restaurant');
      throw new Error('Expected transport failure');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(restaurantErrorKey(error)).toBe('RESTAURANTS.UI.ERRORS.NETWORK');
    }
    expect((await raw('/restaurants/restaurant', 'POST', { name: 'invalid' })).status).toBe(400);
    expect((await raw('/restaurants/outlets/' + rid(900))).status).toBe(404);
  });
  it('verifies all 38 client operations against the canonical runtime registry', async () => {
    await createFixture();
    const map = {
      restaurant: root,
      outlet,
      area: areas[0],
      table: tables[0],
      station: stations[0],
      menu: (await api.get('org-a', 'menu', site()))!,
      category: categories[0],
      item: items[0],
    };
    const ctxFor = (kind: RestaurantKind) =>
      kind === 'table'
        ? { ...site(), areaId: areas[0].id }
        : kind === 'item'
          ? { ...site(), categoryId: categories[0].id }
          : site();
    for (const [kind, entity] of Object.entries(map) as [
      RestaurantKind,
      (typeof map)[RestaurantKind],
    ][]) {
      const ctx = ctxFor(kind);
      await api.get('org-a', kind, ctx, entity.id);
      if (kind !== 'restaurant' && kind !== 'menu') await api.list('org-a', kind, ctx);
      await api.save(
        'org-a',
        kind,
        ctx,
        { expectedVersion: entity.version, name: entity.name },
        entity.id,
      );
      if (kind === 'table') await api.qr('org-a', ctx, entity.id);
      if (kind === 'item') await api.availability('org-a', ctx, entity.id, 2, 'UNAVAILABLE');
    }
    for (const kind of ['item', 'category', 'table', 'station', 'area', 'outlet'] as const)
      await api.deactivate('org-a', kind, ctxFor(kind), map[kind].id, kind === 'item' ? 3 : 2);
    const registry = (await raw('/__test/registry')).body as {
      name: string;
      method: string;
      path: string;
    }[];
    const stats = (await raw('/__test/stats')).body as {
      calls: { name: string; method: string; path: string }[];
      scans: number;
    };
    expect(new Set(stats.calls.map((call) => call.name))).toEqual(
      new Set(registry.map((route) => route.name)),
    );
    expect(registry).toHaveLength(38);
    expect(stats.scans).toBe(0);
  }, 30000);
});
