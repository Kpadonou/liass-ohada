import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { restaurantRouteGuard } from './restaurant-route.guard';
import { accessWorkspace } from './restaurant-access.test-fixture';

describe('Restaurant role-aware routes', () => {
  const workspace = signal<WorkspaceSummary>(accessWorkspace());
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace: workspace,
            effectiveOrgId: () => workspace().orgId,
            activeWorkspaceType: () => workspace().workspaceType,
          },
        },
      ],
    }),
  );
  afterEach(() => TestBed.resetTestingModule());
  const check = (path: string) => {
    const route = { routeConfig: { path } } as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      restaurantRouteGuard(route, {} as RouterStateSnapshot),
    );
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as never);
  };
  it.each(['OWNER', 'MANAGER'] as const)('%s retains management dashboard and routes', (role) => {
    workspace.set(accessWorkspace(role));
    expect(check('')).toBe(true);
    expect(check('setup/team')).toBe(true);
    expect(check('inventory')).toBe(true);
    expect(check('kitchen')).toBe(true);
    expect(check('service')).toBe(true);
    expect(check('service/outlets/:outletId/sessions/:guestSessionId')).toBe(true);
  });
  it('routes KITCHEN to Cuisine without management or Service Floor', () => {
    workspace.set(accessWorkspace('KITCHEN'));
    expect(check('')).toBe('/restaurants/kitchen');
    expect(check('kitchen')).toBe(true);
    expect(check('service')).toBe('/restaurants/kitchen');
    expect(check('setup/team')).toBe('/restaurants/kitchen');
    expect(check('inventory')).toBe('/restaurants');
  });
  it('redirects WAITER landing, reload and direct configuration to Service Floor without management access', () => {
    workspace.set(accessWorkspace('WAITER'));
    expect(check('')).toBe('/restaurants/service');
    expect(check('')).toBe('/restaurants/service');
    expect(check('inventory')).toBe('/restaurants');
    for (const path of ['setup', 'setup/team', 'setup/tables', 'menu'])
      expect(check(path)).toBe('/restaurants/service');
    expect(check('service')).toBe(true);
    expect(check('service/outlets/:outletId/sessions/:guestSessionId')).toBe(true);
    expect(TestBed.inject(RestaurantsCapabilities).canReadStaff()).toBe(false);
  });
  it('allows CASHIER only checkout and denies service/management', () => {
    workspace.set(accessWorkspace('CASHIER'));
    expect(check('checkout')).toBe(true);
    expect(check('inventory')).toBe('/restaurants');
    expect(check('')).toBe('/restaurants/checkout');
    expect(check('service')).toBe('/restaurants/checkout');
    expect(check('setup/team')).toBe('/restaurants/checkout');
    expect(check('service/outlets/:outletId/sessions/:guestSessionId')).toBe('/restaurants');
  });
  it.each(['WAITER', 'KITCHEN'] as const)('%s cannot enter checkout', (role) => {
    workspace.set(accessWorkspace(role));
    expect(check('checkout')).toBe('/restaurants');
  });
  it.each([undefined] as const)('keeps %s on its explicit current-user access state', (role) => {
    workspace.set(accessWorkspace(role));
    expect(check('')).toBe(true);
    expect(check('service')).toBe('/restaurants');
    expect(check('service/outlets/:outletId/sessions/:guestSessionId')).toBe('/restaurants');
    expect(check('setup/team')).toBe('/restaurants');
  });
  it.each(['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const)(
    '%s receipt route stays resource-scoped without a sidebar module',
    (role) => {
      workspace.set(accessWorkspace(role));
      expect(check('outlets/:outletId/sessions/:sessionId/receipt')).toBe(
        ['OWNER', 'MANAGER', 'CASHIER'].includes(role) ? true : '/restaurants',
      );
    },
  );
});
