import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from './restaurant-access-state';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import {
  RestaurantOutletRouting,
  restaurantProductBootstrapGuard,
} from './restaurant-outlet-routing';
import { RestaurantOutletResolutionPage } from '../feature/restaurant-outlet-resolution.page';
import { RestaurantsApi } from './restaurants.api';
import { accessWorkspace } from './restaurant-access.test-fixture';
import { rid, row } from './restaurants.test-fixture';

const activated: string[] = [];
@Component({ template: '<h1>Operational page</h1>' })
class FunctionalPage {
  constructor() {
    activated.push(inject(RestaurantOutletContext).id());
  }
}
@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class ProductHost {}
@Component({ selector: 'test-setup-recovery', template: 'Setup recovery' })
class SetupPage {}

const org = signal('org'),
  user = signal('owner'),
  revision = signal(0),
  role = signal('OWNER');
const availability = signal('AVAILABLE'),
  refreshing = signal(false);
const api = { list: vi.fn(), myOutlets: vi.fn() };
let client: QueryClient, h: RouterTestingHarness;
let routing: RestaurantOutletRouting;
let router: Router;
async function settled(check: () => void) {
  await vi.waitFor(() => {
    h.detectChanges();
    check();
  });
}
beforeEach(async () => {
  sessionStorage.clear();
  activated.length = 0;
  org.set('org');
  user.set('owner');
  revision.set(0);
  role.set('OWNER');
  availability.set('AVAILABLE');
  refreshing.set(false);
  api.list.mockReset().mockResolvedValue({ items: [row('outlet')] });
  api.myOutlets.mockReset().mockResolvedValue({ items: [{ outletId: rid(2), name: 'Agla' }] });
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
          component: ProductHost,
          canActivateChild: [restaurantProductBootstrapGuard],
          children: [
            { path: 'context', component: RestaurantOutletResolutionPage },
            ...[
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
              component: FunctionalPage,
              runGuardsAndResolvers: 'paramsOrQueryParamsChange' as const,
            })),
            { path: 'setup/locations', component: SetupPage },
            { path: '', component: SetupPage },
          ],
        },
      ]),
      { provide: QueryClient, useValue: client },
      { provide: RestaurantsApi, useValue: api },
      { provide: ProductAccessState, useValue: { availability } },
      {
        provide: RestaurantAccessState,
        useValue: {
          refreshing,
          mode: () => (refreshing() ? 'checking' : 'management'),
          refresh: vi.fn(),
        },
      },
      {
        provide: AuthStore,
        useValue: {
          effectiveOrgId: org,
          currentUserId: user,
          contextRevision: revision,
          activeWorkspaceType: () => 'COMPANY',
          activeWorkspace: () => ({ ...accessWorkspace(role() as 'OWNER'), orgId: org() }),
        },
      },
    ],
  });
  h = await RouterTestingHarness.create();
  routing = TestBed.inject(RestaurantOutletRouting);
  router = TestBed.inject(Router);
});
afterEach(() => {
  TestBed.resetTestingModule();
  client.clear();
});

it.each(['OWNER', 'MANAGER', 'WAITER', 'KITCHEN', 'CASHIER'])(
  'resolves an exhaustive singleton for %s before mounting the intended page',
  async (value) => {
    role.set(value);
    let complete!: () => void;
    const deferred = new Promise((resolve) => {
      complete = () =>
        resolve(
          value === 'OWNER' || value === 'MANAGER'
            ? { items: [row('outlet')] }
            : { items: [{ outletId: rid(2), name: 'Agla' }] },
        );
    });
    api.list.mockReturnValue(deferred);
    api.myOutlets.mockReturnValue(deferred);
    await h.navigateByUrl('/restaurants/inventory');
    expect(activated).toEqual([]);
    expect(routing.resolution()).toBe('loading');
    expect(h.routeNativeElement?.querySelector('[aria-busy="true"]')).toBeTruthy();
    complete();
    await settled(() => expect(router.url).toBe('/restaurants/inventory'));
    expect(activated).toEqual([rid(2)]);
    expect(h.routeNativeElement?.querySelector('liass-restaurant-outlet-resolution')).toBeNull();
  },
);
it('blocks activation for multiple choices, then resumes the exact intended destination', async () => {
  api.list.mockResolvedValue({
    items: [row('outlet'), { ...row('outlet'), id: rid(8), name: 'Jardin' }],
  });
  await h.navigateByUrl('/restaurants/service?area=terrace');
  await settled(() => expect(routing.resolution()).toBe('selection-required'));
  expect(activated).toEqual([]);
  routing.choose(rid(8));
  await settled(() =>
    expect(router.url).toBe(`/restaurants/service?area=terrace&outlet=${rid(8)}`),
  );
  expect(activated).toEqual([rid(8)]);
});
it('does not assume a singleton or zero while discovery has another page', async () => {
  api.list
    .mockResolvedValueOnce({ items: [row('outlet')], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [] });
  await h.navigateByUrl('/restaurants/kitchen');
  await settled(() => expect(routing.resolution()).toBe('selection-required'));
  expect(routing.context.id()).toBe('');
  expect(activated).toEqual([]);
  await routing.context.source().fetchNextPage();
  await settled(() => expect(router.url).toBe('/restaurants/kitchen'));
  expect(activated).toEqual([rid(2)]);
});
it('reuses one fresh discovery across Service → Kitchen → Checkout → Inventory', async () => {
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(router.url).toBe('/restaurants/service'));
  const destinations: string[] = [];
  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationEnd) destinations.push(event.urlAfterRedirects);
  });
  for (const page of ['kitchen', 'checkout', 'inventory', 'cash', 'cash/day'])
    await h.navigateByUrl('/restaurants/' + page);
  subscription.unsubscribe();
  expect(destinations).toEqual([
    '/restaurants/kitchen',
    '/restaurants/checkout',
    '/restaurants/inventory',
    '/restaurants/cash',
    '/restaurants/cash/day',
  ]);
  expect(api.list).toHaveBeenCalledTimes(1);
  expect(activated).toEqual(Array(6).fill(rid(2)));
});
it('still revalidates stale discovery when re-entering operations', async () => {
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(activated).toHaveLength(1));
  await h.navigateByUrl('/restaurants/setup/locations');
  await client.invalidateQueries({
    queryKey: ['restaurants', org(), 'operational-outlets'],
    refetchType: 'none',
  });
  await h.navigateByUrl('/restaurants/inventory');
  await settled(() => expect(api.list).toHaveBeenCalledTimes(2));
  expect(routing.context.id()).toBe(rid(2));
});
it('gates setup for zero outlets without activating functional content', async () => {
  api.list.mockResolvedValue({ items: [] });
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(routing.resolution()).toBe('no-accessible-context'));
  expect(activated).toEqual([]);
  await h.navigateByUrl('/restaurants/setup/locations');
  expect(h.routeNativeElement?.textContent).not.toContain('Setup recovery');
  expect(routing.context.attached()).toBe(true);
});
it('reports transport error separately from empty context', async () => {
  api.list.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(routing.resolution()).toBe('error'));
  expect(activated).toEqual([]);
});
it('requires explicit initial choice for an authorized resource deep link', async () => {
  api.list.mockResolvedValue({ items: [row('outlet'), { ...row('outlet'), id: rid(8) }] });
  const url = `/restaurants/service/outlets/${rid(8)}/sessions/${rid(20)}?area=terrace`;
  await h.navigateByUrl(url);
  await settled(() => expect(routing.resolution()).toBe('selection-required'));
  routing.choose(rid(8));
  await settled(() => expect(router.url).toContain(url));
  expect(activated).toEqual([rid(8)]);
});
it.each(['resource', 'query'])(
  'rejects a foreign %s hint rather than authorizing a fallback singleton',
  async (kind) => {
    const url =
      kind === 'resource'
        ? `/restaurants/service/outlets/${rid(99)}/sessions/${rid(20)}`
        : `/restaurants/service?outlet=${rid(99)}`;
    await h.navigateByUrl(url);
    await settled(() => expect(routing.resolution()).toBe('invalid-selection'));
    expect(activated).toEqual([]);
    if (kind === 'resource') {
      routing.choose(rid(2));
      expect(routing.resolution()).toBe('invalid-selection');
    } else {
      routing.choose(rid(2));
      expect(activated).toEqual([]);
    }
  },
);
it('ignores switch attempts after the initial choice and rejects a different authorized parent', async () => {
  api.list.mockResolvedValue({ items: [row('outlet'), { ...row('outlet'), id: rid(8) }] });
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(routing.resolution()).toBe('selection-required'));
  routing.choose(rid(2));
  await settled(() => expect(activated).toHaveLength(1));
  routing.context.select(rid(8));
  expect(routing.context.id()).toBe(rid(2));
  await h.navigateByUrl(`/restaurants/outlets/${rid(8)}/sessions/${rid(20)}/receipt`);
  await settled(() => expect(routing.resolution()).toBe('invalid-selection'));
  expect(activated).toHaveLength(1);
  expect(api.list).toHaveBeenCalledTimes(1);
});
it('invalidates revoked context and leaves the operational route before reconciliation completes', async () => {
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(activated).toHaveLength(1));
  let release!: () => void;
  api.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ items: [] });
      }),
  );
  const pending = routing.context.revoke(rid(2));
  expect(routing.routeReady()).toBe(false);
  await settled(() => expect(router.url).toContain('/restaurants/context?'));
  expect(h.routeNativeElement?.textContent).not.toContain('Operational page');
  release();
  await pending;
  await settled(() => expect(routing.resolution()).toBe('access-changed'));
});
it('blocks active content immediately during access refresh and explicitly resumes the same principal', async () => {
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(activated).toHaveLength(1));
  const refresh = vi.spyOn(routing.access, 'refresh').mockImplementation(async () => {
    refreshing.set(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    refreshing.set(false);
  });
  await routing.refreshAccess();
  await settled(() => expect(routing.resolution()).toBe('ready'));
  expect(refresh).toHaveBeenCalledOnce();
  await settled(() => expect(router.url).toBe('/restaurants/service'));
});
it.each(['organization', 'principal', 'revision', 'role'])(
  'does not reuse selection or late discovery after %s changes',
  async (change) => {
    let release!: () => void;
    api.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ items: [row('outlet')] });
        }),
    );
    await h.navigateByUrl('/restaurants/service');
    await settled(() => expect(release).toBeDefined());
    if (change === 'organization') org.set('other-org');
    if (change === 'principal') user.set('other-user');
    if (change === 'revision') revision.set(1);
    if (change === 'role') role.set('MANAGER');
    expect(routing.context.id()).toBe('');
    release();
    // A return URL captured for the old identity cannot activate a page for the new one.
    await settled(() => expect(routing.destination()).toBeNull());
    expect(activated).toEqual([]);
  },
);
it('rejects external, auxiliary, matrix and non-operational return destinations', () => {
  for (const url of [
    'https://example.com',
    '//example.com',
    '/restaurants/unknown',
    '/restaurants/service;outlet=foreign',
    '/restaurants/service(aux:other)',
  ])
    expect(routing.validDestination(url)).toBe(false);
});

it('reuses a chosen multi-Outlet context through Cash deep links and setup round trips', async () => {
  api.list.mockResolvedValue({ items: [row('outlet'), { ...row('outlet'), id: rid(8) }] });
  await h.navigateByUrl('/restaurants/cash/day');
  await settled(() => expect(routing.resolution()).toBe('selection-required'));
  expect(router.url).toContain('returnUrl=%2Frestaurants%2Fcash%2Fday');
  routing.choose(rid(8));
  await settled(() => expect(router.url).toBe(`/restaurants/cash/day?outlet=${rid(8)}`));
  for (const path of ['service', 'kitchen', 'checkout', 'inventory', 'cash', 'cash/day']) {
    await h.navigateByUrl('/restaurants/' + path);
    expect(router.url).not.toContain('/context');
    expect(routing.context.id()).toBe(rid(8));
  }
  await h.navigateByUrl('/restaurants/setup/locations');
  await h.navigateByUrl('/restaurants/cash/day');
  expect(router.url).toBe('/restaurants/cash/day');
  expect(api.list).toHaveBeenCalledTimes(1);
});

it('retains authorized cached context during same-identity transport refresh failure, but fences a 403', async () => {
  await h.navigateByUrl('/restaurants/cash/day');
  await settled(() => expect(activated).toEqual([rid(2)]));
  api.list.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
  await routing.context.source().refetch();
  await settled(() => expect(routing.routeReady()).toBe(true));
  expect(routing.context.id()).toBe(rid(2));
  await h.navigateByUrl('/restaurants/inventory');
  expect(router.url).toBe('/restaurants/inventory');
  api.list.mockRejectedValueOnce(new HttpErrorResponse({ status: 403 }));
  await routing.context.source().refetch();
  await settled(() => expect(routing.context.id()).toBe(''));
  expect(router.url).toContain('/restaurants/context');
});
it.each([1, 2, 0])(
  'revoked selection with %s accessible alternatives resolves without inventing context',
  async (alternatives) => {
    await h.navigateByUrl(`/restaurants/service?outlet=${rid(2)}`);
    await settled(() => expect(activated).toHaveLength(1));
    api.list.mockResolvedValue({
      items: Array.from({ length: alternatives }, (_, n) => ({ ...row('outlet'), id: rid(8 + n) })),
    });
    await routing.context.revoke(rid(2));
    await settled(() => expect(routing.resolution()).toBe('access-changed'));
    expect(routing.context.id()).toBe('');
  },
);
it('exhausts a paginated multi-Outlet discovery once and reuses the chosen context through Cash', async () => {
  api.list
    .mockResolvedValueOnce({ items: [row('outlet')], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [{ ...row('outlet'), id: rid(8) }] });
  await h.navigateByUrl('/restaurants/cash/day');
  await settled(() => expect(routing.resolution()).toBe('selection-required'));
  expect(routing.context.id()).toBe('');
  await routing.context.source().fetchNextPage();
  await settled(() => expect(routing.context.outlets()).toHaveLength(2));
  routing.choose(rid(8));
  await settled(() => expect(routing.context.id()).toBe(rid(8)));
  await h.navigateByUrl('/restaurants/service');
  await h.navigateByUrl('/restaurants/cash');
  expect(router.url).toBe('/restaurants/cash');
  expect(api.list).toHaveBeenCalledTimes(2);
});

it('cannot resume a foreign resource parent while a compatible cached Outlet survives transport failure', async () => {
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(activated).toEqual([rid(2)]));
  api.list.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
  await routing.context.source().refetch();
  await h.navigateByUrl(`/restaurants/service/outlets/${rid(8)}/sessions/${rid(20)}`);
  await settled(() => expect(routing.resolution()).toBe('invalid-selection'));
  expect(activated).toEqual([rid(2)]);
  expect(routing.context.id()).toBe(rid(2));
});
