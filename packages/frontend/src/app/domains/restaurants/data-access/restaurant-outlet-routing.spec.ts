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
import { RestaurantOutletRouting, restaurantOutletGuard } from './restaurant-outlet-routing';
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
@Component({ template: 'Setup recovery' })
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
          children: [
            { path: 'context', component: RestaurantOutletResolutionPage },
            ...[
              'service',
              'kitchen',
              'checkout',
              'inventory',
              'service/outlets/:outletId/sessions/:guestSessionId',
              'outlets/:outletId/sessions/:sessionId/receipt',
            ].map((path) => ({
              path,
              component: FunctionalPage,
              canActivate: [restaurantOutletGuard],
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
  for (const page of ['kitchen', 'checkout', 'inventory'])
    await h.navigateByUrl('/restaurants/' + page);
  subscription.unsubscribe();
  expect(destinations).toEqual([
    '/restaurants/kitchen',
    '/restaurants/checkout',
    '/restaurants/inventory',
  ]);
  expect(api.list).toHaveBeenCalledTimes(1);
  expect(activated).toEqual([rid(2), rid(2), rid(2), rid(2)]);
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
it('keeps setup reachable for zero outlets without activating functional content', async () => {
  api.list.mockResolvedValue({ items: [] });
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(routing.resolution()).toBe('no-accessible-context'));
  expect(activated).toEqual([]);
  await h.navigateByUrl('/restaurants/setup/locations');
  expect(h.routeNativeElement?.textContent).toContain('Setup recovery');
  expect(routing.context.attached()).toBe(false);
});
it('reports transport error separately from empty context', async () => {
  api.list.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
  await h.navigateByUrl('/restaurants/service');
  await settled(() => expect(routing.resolution()).toBe('error'));
  expect(activated).toEqual([]);
});
it('validates a resource deep link and adopts its authorized Outlet', async () => {
  api.list.mockResolvedValue({ items: [row('outlet'), { ...row('outlet'), id: rid(8) }] });
  const url = `/restaurants/service/outlets/${rid(8)}/sessions/${rid(20)}?area=terrace`;
  await h.navigateByUrl(url);
  await settled(() => expect(router.url).toBe(url));
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
      await settled(() => expect(activated).toEqual([rid(2)]));
    }
  },
);
it('clears Area on shell switch and exits old resource deep links', async () => {
  api.list.mockResolvedValue({ items: [row('outlet'), { ...row('outlet'), id: rid(8) }] });
  await h.navigateByUrl(`/restaurants/service?outlet=${rid(2)}&area=terrace`);
  await settled(() => expect(activated).toHaveLength(1));
  await routing.switchOutlet(rid(8));
  expect(router.url).toBe(`/restaurants/service?outlet=${rid(8)}`);
  expect(routing.context.id()).toBe(rid(8));
  const link = `/restaurants/outlets/${rid(8)}/sessions/${rid(20)}/receipt`;
  await h.navigateByUrl(link);
  await routing.switchOutlet(rid(2));
  expect(router.url).toBe(`/restaurants/checkout?outlet=${rid(2)}`);
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
  await settled(() => expect(routing.resolution()).toBe('no-accessible-context'));
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
    '/restaurants/setup',
    '/restaurants/service;outlet=foreign',
    '/restaurants/service(aux:other)',
  ])
    expect(routing.validDestination(url)).toBe(false);
});
