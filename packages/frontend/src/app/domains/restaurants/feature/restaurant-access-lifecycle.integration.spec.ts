import {
  RestaurantOutletRouting,
  restaurantProductBootstrapGuard,
} from '../data-access/restaurant-outlet-routing';
import { RestaurantOutletResolutionPage } from './restaurant-outlet-resolution.page';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient, queryOptions } from '@tanstack/angular-query-experimental';
import type { WorkspaceSummary, RestaurantsRole } from '@liass-ohada/shared/shared';
import { NotificationService } from '../../../core/notifications/notification.service';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { ProductAccessQueries } from '../../../core/product-access/product-access.queries';
import { RestaurantsPage } from '../../../core/restaurants/restaurants.page';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import { restaurantRouteGuard } from '../data-access/restaurant-route.guard';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantCheckoutPage } from './restaurant-checkout.page';
import { RestaurantServiceFloorPage } from './restaurant-service-floor.page';
import { accessWorkspace } from '../data-access/restaurant-access.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import { floorFixture } from '../data-access/service-floor.test-fixture';
import fr from '../../../../../public/assets/i18n/fr.json';

@Component({ template: '<h1>Management dashboard fixture</h1>' })
class ManagementDashboard {}
@Component({ selector: 'test-management-detail', template: 'Protected management fixture' })
class ManagementDetail {}
@Component({ selector: 'test-kitchen-workflow', template: 'Kitchen workflow fixture' })
class KitchenWorkflow {}

describe('Current-user Restaurants lifecycle through actual routing and Service Floor', () => {
  const workspace = signal<WorkspaceSummary>(accessWorkspace());
  let remoteRole: RestaurantsRole | undefined, assigned: boolean, client: QueryClient;
  const loadWorkspaces = vi.fn(),
    myOutlets = vi.fn(),
    serviceFloor = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    workspace.set(accessWorkspace());
    remoteRole = undefined;
    assigned = false;
    loadWorkspaces.mockReset().mockImplementation(async () => {
      workspace.set(accessWorkspace(remoteRole));
      return [workspace()];
    });
    myOutlets.mockReset().mockImplementation(async () => ({
      items: assigned ? [{ outletId: rid(2), name: 'Établissement du Centre' }] : [],
    }));
    serviceFloor.mockReset().mockResolvedValue(floorFixture());
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
            component: RestaurantsPage,
            canActivateChild: [restaurantRouteGuard, restaurantProductBootstrapGuard],
            children: [
              { path: '', component: ManagementDashboard },
              { path: 'context', component: RestaurantOutletResolutionPage },
              { path: 'setup/locations', component: ManagementDetail },
              { path: 'kitchen', component: KitchenWorkflow },
              {
                path: 'checkout',
                component: RestaurantCheckoutPage,
              },
              {
                path: 'service',
                component: RestaurantServiceFloorPage,
              },
              { path: 'setup/team', component: ManagementDetail },
              { path: 'setup', component: ManagementDetail },
            ],
          },
        ]),
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace: workspace,
            effectiveOrgId: () => workspace().orgId,
            activeWorkspaceType: () => workspace().workspaceType,
            currentUserId: () => 'fixture-user',
            contextRevision: () => 0,
            workspacesLoaded: () => true,
            workspaceError: () => null,
            loadWorkspaces,
          },
        },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        {
          provide: ProductAccessQueries,
          useValue: {
            list: () =>
              queryOptions({
                queryKey: ['product-access', workspace().orgId],
                queryFn: async () => [],
              }),
          },
        },
        { provide: QueryClient, useValue: client },
        {
          provide: RestaurantsApi,
          useValue: { myOutlets, serviceFloor, list: async () => ({ items: [] }) },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it('mirrors accepted membership → role → zero assignments → assigned outlet → genuine role removal without logout', async () => {
    const h = await RouterTestingHarness.create('/restaurants');
    expect(h.routeNativeElement?.textContent).toContain(
      fr.RESTAURANTS.CONTEXT.RESOLUTION['access-changed'],
    );
    expect(h.routeNativeElement?.querySelector('[role="alert"]')).not.toBeNull();
    expect(h.routeNativeElement?.textContent).not.toContain('Management dashboard');
    expect(myOutlets).not.toHaveBeenCalled();
    remoteRole = 'WAITER';
    await TestBed.inject(RestaurantOutletRouting).refreshAccess();
    await vi.waitFor(() => {
      h.detectChanges();
      expect(TestBed.inject(Router).url).toContain('/restaurants/context?');
      expect(h.routeNativeElement?.textContent).toContain(
        fr.RESTAURANTS.CONTEXT.RESOLUTION['no-accessible-context'],
      );
    });
    expect(serviceFloor).not.toHaveBeenCalled();
    assigned = true;
    await TestBed.inject(RestaurantOutletRouting).refreshAccess();
    await vi.waitFor(() => {
      h.detectChanges();
      expect(TestBed.inject(RestaurantOutletContext).outlet()?.name).toBe(
        'Établissement du Centre',
      );
      expect(h.routeNativeElement?.textContent).toContain('T01');
    });
    remoteRole = undefined;
    await TestBed.inject(RestaurantAccessState).refresh();
    await vi.waitFor(() => {
      h.detectChanges();
      expect(h.routeNativeElement?.textContent).toContain(
        fr.RESTAURANTS.CONTEXT.RESOLUTION['access-changed'],
      );
    });
    expect(h.routeNativeElement?.querySelector('[data-access-state="configure"]')).toBeNull();
    expect(h.routeNativeElement?.textContent).not.toContain('T01');
  });
  it('prevents direct no-role Service and WAITER Team/configuration content before activation', async () => {
    const h = await RouterTestingHarness.create('/restaurants/service');
    expect(TestBed.inject(Router).url).toContain('/restaurants/context?');
    expect(myOutlets).not.toHaveBeenCalled();
    workspace.set(accessWorkspace('WAITER'));
    await h.navigateByUrl('/restaurants/setup/team');
    await vi.waitFor(() => {
      h.detectChanges();
      expect(TestBed.inject(Router).url).toContain('/restaurants/context?');
    });
    expect(h.routeNativeElement?.textContent).not.toContain('Protected management fixture');
  });
  it.each(['OWNER', 'MANAGER'] as const)(
    'keeps zero-Outlet %s inside isolated unavailable entry',
    async (role) => {
      workspace.set(accessWorkspace(role));
      const h = await RouterTestingHarness.create('/restaurants');
      await vi.waitFor(() => {
        h.detectChanges();
        expect(TestBed.inject(RestaurantOutletRouting).resolution()).toBe('no-accessible-context');
      });
      expect(h.routeNativeElement?.textContent).not.toContain('Management dashboard fixture');
      await h.navigateByUrl('/restaurants');
      expect(h.routeNativeElement?.textContent).not.toContain('Management dashboard fixture');
      expect(TestBed.inject(Router).url).toContain('/restaurants/context?');
    },
  );
  it('lands KITCHEN on its operational route without starting Service Floor', async () => {
    workspace.set(accessWorkspace('KITCHEN'));
    const h = await RouterTestingHarness.create('/restaurants');
    await vi.waitFor(() => {
      h.detectChanges();
      expect(TestBed.inject(Router).url).toContain('/restaurants/context?');
      expect(h.routeNativeElement?.textContent).toContain(
        fr.RESTAURANTS.CONTEXT.RESOLUTION['no-accessible-context'],
      );
    });
    expect(h.routeNativeElement?.textContent).not.toContain('Kitchen workflow fixture');
    expect(myOutlets).toHaveBeenCalledTimes(1);
  });
  it.each(['CASHIER'] as const)(
    'lands %s on the real Caisse and reads its own outlet assignments',
    async (role) => {
      workspace.set(accessWorkspace(role));
      const h = await RouterTestingHarness.create('/restaurants');
      expect(TestBed.inject(Router).url).toContain('/restaurants/context?');
      await vi.waitFor(() => {
        h.detectChanges();
        expect(h.routeNativeElement?.textContent).toContain(
          fr.RESTAURANTS.CONTEXT.RESOLUTION['no-accessible-context'],
        );
      });
      expect(h.routeNativeElement?.textContent).not.toContain(fr.RESTAURANTS.CONTEXT.CHOOSE);
      expect(h.routeNativeElement?.textContent).not.toContain('Management dashboard');
      expect(myOutlets).toHaveBeenCalledTimes(1);
      expect(serviceFloor).not.toHaveBeenCalled();
    },
  );
  it('loads the canonical occupied-table discovery in the real assigned CASHIER landing', async () => {
    workspace.set(accessWorkspace('CASHIER'));
    assigned = true;
    const h = await RouterTestingHarness.create('/restaurants');
    await vi.waitFor(() => {
      h.detectChanges();
      expect(serviceFloor).toHaveBeenCalledTimes(1);
    });
    expect(TestBed.inject(Router).url).toBe('/restaurants/checkout');
    expect(h.routeNativeElement?.textContent).toContain('Caisse');
    expect(h.routeNativeElement?.querySelector('liass-restaurant-service-floor')).toBeNull();
    expect(myOutlets).toHaveBeenCalledTimes(1);
  });
});
