import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from './restaurant-access-state';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import {
  RestaurantOutletRouting,
  restaurantProductBootstrapGuard,
} from './restaurant-outlet-routing';
import { RestaurantOutletResolutionPage } from '../feature/restaurant-outlet-resolution.page';
import { rid, row } from './restaurants.test-fixture';

const org = signal('org'),
  user = signal('owner'),
  workspace = signal('org'),
  revision = signal(1);
const activated: string[] = [];
@Component({
  selector: 'bootstrap-product',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class Product {}
@Component({ selector: 'bootstrap-function', template: 'Functional content' })
class Functional {
  constructor() {
    activated.push(inject(RestaurantOutletContext).id());
  }
}
@Component({ selector: 'bootstrap-setup', template: 'Setup recovery' })
class Setup {}
const a = row('outlet'),
  b = { ...row('outlet'), id: rid(8), name: 'B' };
const api = { list: vi.fn(), myOutlets: vi.fn() };
let client: QueryClient, h: RouterTestingHarness, router: Router, routing: RestaurantOutletRouting;
const keys = () =>
  Object.keys(localStorage).filter((key) =>
    key.startsWith('liass-ohada.restaurants.activeOutletId.'),
  );
const stored = () => keys().map((key) => localStorage.getItem(key));
async function configure() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      provideRouter([
        {
          path: 'restaurants',
          component: Product,
          canActivateChild: [restaurantProductBootstrapGuard],
          children: [
            { path: 'context', component: RestaurantOutletResolutionPage },
            { path: 'setup/locations', component: Setup },
            ...[
              '',
              'service',
              'kitchen',
              'checkout',
              'inventory',
              'cash',
              'cash/day',
              'service/outlets/:outletId/sessions/:guestSessionId',
              'outlets/:outletId/sessions/:sessionId/receipt',
            ].map((path) => ({
              path,
              component: Functional,
              pathMatch: 'full' as const,
              runGuardsAndResolvers: 'paramsOrQueryParamsChange' as const,
            })),
          ],
        },
      ]),
      { provide: QueryClient, useValue: client },
      { provide: RestaurantsApi, useValue: api },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      {
        provide: RestaurantAccessState,
        useValue: { refreshing: () => false, mode: () => 'management' },
      },
      {
        provide: AuthStore,
        useValue: {
          effectiveOrgId: org,
          currentUserId: user,
          contextRevision: revision,
          activeWorkspaceType: () => 'COMPANY',
          activeWorkspace: () => ({ orgId: workspace(), productRoles: { RESTAURANTS: 'OWNER' } }),
        },
      },
    ],
  });
  h = await RouterTestingHarness.create();
  router = TestBed.inject(Router);
  routing = TestBed.inject(RestaurantOutletRouting);
}
async function settle(check: () => void) {
  await vi.waitFor(() => {
    h.detectChanges();
    check();
  });
}
async function reload() {
  TestBed.resetTestingModule();
  client.clear();
  activated.length = 0;
  await configure();
}
beforeEach(async () => {
  localStorage.clear();
  activated.length = 0;
  org.set('org');
  user.set('owner');
  workspace.set('org');
  revision.set(1);
  api.list.mockReset().mockResolvedValue({ items: [a, b] });
  api.myOutlets.mockReset();
  await configure();
});
afterEach(() => {
  TestBed.resetTestingModule();
  client.clear();
});

it('product root selects once before activation, persists an ID only, and restores a reconstructed app without choosing', async () => {
  await h.navigateByUrl('/restaurants');
  await settle(() => expect(routing.resolution()).toBe('selection-required'));
  expect(activated).toEqual([]);
  expect(router.url).toContain('returnUrl=%2Frestaurants');
  routing.choose(a.id);
  await settle(() => expect(activated).toEqual([a.id]));
  expect(stored()).toEqual([a.id]);
  expect(api.list).toHaveBeenCalledTimes(1);
  for (const path of ['service', 'kitchen', 'checkout', 'inventory', 'cash', 'cash/day']) {
    await h.navigateByUrl('/restaurants/' + path);
    expect(router.url).not.toContain('/context');
  }
  expect(api.list).toHaveBeenCalledTimes(1);
  await reload();
  await h.navigateByUrl('/restaurants/cash/day');
  await settle(() => expect(router.url).toBe('/restaurants/cash/day'));
  expect(activated).toEqual([a.id]);
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(stored()).toEqual([a.id]);
});
it('global switch persists B, exits an A resource safely, reuses discovery, and restores B on reload', async () => {
  await h.navigateByUrl(`/restaurants/service/outlets/${a.id}/sessions/${rid(20)}`);
  await settle(() => expect(activated).toEqual([a.id]));
  await routing.switchOutlet(b.id);
  expect(router.url).toBe(`/restaurants/service?outlet=${b.id}`);
  expect(stored()).toEqual([b.id]);
  expect(api.list).toHaveBeenCalledTimes(1);
  await reload();
  await h.navigateByUrl('/restaurants/inventory');
  await settle(() => expect(activated).toEqual([b.id]));
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(router.url).toBe('/restaurants/inventory');
});
it.each(['/restaurants', '/restaurants/cash/day', '/restaurants/inventory'])(
  'one Outlet never requires a choice at %s, including reload/setup round-trip',
  async (url) => {
    api.list.mockResolvedValue({ items: [a] });
    await h.navigateByUrl(url);
    await settle(() => expect(activated).toEqual([a.id]));
    expect(stored()).toEqual([a.id]);
    await h.navigateByUrl('/restaurants/setup/locations');
    await h.navigateByUrl('/restaurants/inventory');
    expect(router.url).toBe('/restaurants/inventory');
    expect(api.list).toHaveBeenCalledTimes(1);
    await reload();
    await h.navigateByUrl(url);
    await settle(() => expect(activated).toEqual([a.id]));
    expect(api.list).toHaveBeenCalledTimes(2);
  },
);
it('a stored preference is not runtime authorization before validation completes', async () => {
  await h.navigateByUrl(`/restaurants/service?outlet=${a.id}`);
  await settle(() => expect(activated).toEqual([a.id]));
  await reload();
  let release!: () => void;
  api.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ items: [a, b] });
      }),
  );
  await h.navigateByUrl('/restaurants/cash/day');
  expect(activated).toEqual([]);
  expect(routing.context.id()).toBe('');
  release();
  await settle(() => expect(activated).toEqual([a.id]));
});
it.each([0, 1, 2])(
  'rejects a missing/revoked persisted Outlet with %s remaining alternatives',
  async (count) => {
    await h.navigateByUrl(`/restaurants/service?outlet=${b.id}`);
    await settle(() => expect(activated).toEqual([b.id]));
    await reload();
    api.list.mockResolvedValue({ items: [a, { ...a, id: rid(9) }].slice(0, count) });
    await h.navigateByUrl('/restaurants/cash/day');
    await settle(() =>
      expect(routing.resolution()).toBe(
        count === 1 ? 'ready' : count === 2 ? 'selection-required' : 'no-accessible-context',
      ),
    );
    expect(routing.context.id()).toBe(count === 1 ? a.id : '');
    expect(stored()).toEqual(count === 1 ? [a.id] : []);
    if (count === 0) {
      await h.navigateByUrl('/restaurants/setup/locations');
      expect(h.routeNativeElement?.textContent).toContain('Setup recovery');
    }
  },
);
it.each(['user', 'org', 'workspace'])(
  'does not reuse persisted preference across %s scope',
  async (dimension) => {
    await h.navigateByUrl(`/restaurants/service?outlet=${b.id}`);
    await settle(() => expect(activated).toEqual([b.id]));
    await reload();
    if (dimension === 'user') user.set('other');
    if (dimension === 'org') {
      org.set('other');
      workspace.set('other');
    }
    if (dimension === 'workspace') workspace.set('firm');
    await h.navigateByUrl('/restaurants');
    await settle(() =>
      expect(routing.resolution()).toBe(
        dimension === 'workspace' ? 'access-changed' : 'selection-required',
      ),
    );
    expect(activated).toEqual([]);
    expect(routing.context.id()).toBe('');
    expect(stored()).toEqual([b.id]);
  },
);
it('restores a saved Outlet on a later authorized page without requiring another human selection', async () => {
  await h.navigateByUrl(`/restaurants/service?outlet=${b.id}`);
  await settle(() => expect(activated).toEqual([b.id]));
  await reload();
  api.list
    .mockResolvedValueOnce({ items: [a], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [b] });
  await h.navigateByUrl('/restaurants/cash/day');
  await settle(() => expect(activated).toEqual([b.id]));
  expect(api.list).toHaveBeenCalledTimes(3);
  expect(router.url).toBe('/restaurants/cash/day');
});
it('does not let a persisted authorized Outlet authorize a foreign resource parent', async () => {
  await h.navigateByUrl(`/restaurants/service?outlet=${a.id}`);
  await settle(() => expect(activated).toEqual([a.id]));
  await reload();
  await h.navigateByUrl(`/restaurants/service/outlets/${rid(99)}/sessions/${rid(20)}`);
  await settle(() => expect(routing.resolution()).toBe('invalid-selection'));
  expect(activated).toEqual([]);
  expect(stored()).toEqual([a.id]);
  await h.navigateByUrl('/restaurants');
  await settle(() => expect(activated).toEqual([a.id]));
  expect(router.url).toBe('/restaurants');
});
it('discard malformed storage without parsing or storing any canonical Outlet DTO', async () => {
  await h.navigateByUrl(`/restaurants/service?outlet=${a.id}`);
  await settle(() => expect(activated).toEqual([a.id]));
  const key = keys()[0];
  localStorage.setItem(key, JSON.stringify(a));
  await reload();
  await h.navigateByUrl('/restaurants');
  await settle(() => expect(routing.resolution()).toBe('selection-required'));
  expect(stored()).toEqual([]);
  expect(activated).toEqual([]);
});
it('withdraws active context on logout and does not bootstrap without a principal', async () => {
  await h.navigateByUrl(`/restaurants/service?outlet=${a.id}`);
  await settle(() => expect(activated).toEqual([a.id]));
  user.set('');
  TestBed.tick();
  expect(routing.context.id()).toBe('');
  expect(routing.context.available()).toBe(false);
  expect(stored()).toEqual([a.id]);
  expect(api.list).toHaveBeenCalledTimes(1);
});
it('rejects an inactive saved Outlet, automatically selecting the sole active alternative', async () => {
  await h.navigateByUrl(`/restaurants/service?outlet=${b.id}`);
  await settle(() => expect(activated).toEqual([b.id]));
  await reload();
  api.list.mockResolvedValue({ items: [a, { ...b, isActive: false }] });
  await h.navigateByUrl('/restaurants');
  await settle(() => expect(activated).toEqual([a.id]));
  expect(stored()).toEqual([a.id]);
});
