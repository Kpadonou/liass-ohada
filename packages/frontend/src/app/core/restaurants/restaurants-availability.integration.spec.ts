import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { ProductAccess } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { RestaurantsCapabilities } from '../../domains/restaurants/data-access/restaurants-capabilities';
import { SalesCapabilities } from '../../domains/sales/data-access/sales-capabilities';
import { CabinetSettingsCapabilities } from '../../domains/identity/data-access/cabinet-settings-capabilities';
import { UiStore } from '../state/ui.store';
import { ProductAccessApi } from '../product-access/product-access.api';
import { ProductAccessState } from '../product-access/product-access.state';
import { productAccessQueryKeys } from '../product-access/product-access.queries';
import { productAccessGuard } from '../product-access/product-access.guard';
import { AppSidebarComponent } from '../../shared/layout/app-sidebar/app-sidebar.component';
import { RestaurantsPage } from './restaurants.page';

// Use real state, query helpers, cache, guard and sidebar availability computation.
// Keep unrelated navigation out of this focused cross-surface regression.
describe('canonical restaurant availability across frontend surfaces', () => {
  const org = signal('org-a');
  let client: QueryClient;
  let remote: ProductAccess[];
  const listProductAccess = vi.fn();
  const access = (status: 'ACTIVE' | 'INACTIVE', orgId = org()): ProductAccess[] => [
    {
      orgId,
      productCode: 'RESTAURANTS',
      status,
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    },
  ];
  beforeEach(async () => {
    org.set('org-a');
    remote = [];
    listProductAccess.mockReset();
    listProductAccess.mockImplementation(async () => remote);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantsPage,
        AppSidebarComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: {} },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: client },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: org,
            currentUserId: () => 'fixture-user',
            activeWorkspace: () => ({
              orgId: org(),
              workspaceType: 'COMPANY',
              status: 'ACTIVE',
              accessSource: 'DIRECT',
              productRoles: { RESTAURANTS: 'OWNER' },
            }),
            workspaceError: () => null,
            contextRevision: () => 0,
            isAuthenticated: () => true,
            workspacesLoaded: () => true,
          },
        },
        { provide: ProductAccessApi, useValue: { listProductAccess } },
        {
          provide: RestaurantsCapabilities,
          useValue: { canRead: () => false, canReadMenu: () => false },
        },
        { provide: CabinetSettingsCapabilities, useValue: {} },
        { provide: SalesCapabilities, useValue: {} },
        { provide: UiStore, useValue: {} },
      ],
    }).overrideComponent(AppSidebarComponent, {
      set: {
        template: '@if (showRestaurantsNavigation()) { <a href="/restaurants">Liass-Resto</a> }',
      },
    });
    await TestBed.compileComponents();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  const guard = () => {
    const route = new ActivatedRouteSnapshot();
    route.data = { productCode: 'RESTAURANTS' };
    return TestBed.runInInjectionContext(() =>
      productAccessGuard(route, { url: '/restaurants' } as RouterStateSnapshot),
    );
  };
  function surfaces() {
    const sidebar = TestBed.createComponent(AppSidebarComponent),
      page = TestBed.createComponent(RestaurantsPage);
    return {
      sidebar,
      page,
      assertAvailable: async (available: boolean) => {
        await vi.waitFor(() => {
          sidebar.detectChanges();
          page.detectChanges();
          expect(!!sidebar.nativeElement.querySelector('a[href="/restaurants"]')).toBe(available);
          expect(!!page.nativeElement.querySelector('router-outlet')).toBe(available);
          expect(TestBed.inject(ProductAccessState).availability('RESTAURANTS')).toBe(
            available ? 'AVAILABLE' : 'UNAVAILABLE',
          );
        });
      },
    };
  }
  it('ACTIVE renders page, shows sidebar and permits route independently of action RBAC', async () => {
    client.setQueryData(productAccessQueryKeys.list(org()), access('ACTIVE'));
    const f = surfaces();
    await f.assertAvailable(true);
    expect(await guard()).toBe(true);
    expect(f.page.nativeElement.querySelector('a[href="/restaurants/setup"]')).toBeNull();
    expect(listProductAccess).not.toHaveBeenCalled();
  });
  it.each([{ records: [] }, { records: access('INACTIVE', 'org-a') }])(
    'absent/inactive hides sidebar, removes content and denies entry: %j',
    async ({ records }) => {
      client.setQueryData(productAccessQueryKeys.list(org()), records);
      const f = surfaces();
      await f.assertAvailable(false);
      expect(
        TestBed.inject(Router).serializeUrl((await guard()) as ReturnType<Router['createUrlTree']>),
      ).toBe('/dashboard');
    },
  );
  it('switches organizations without carrying previous-organization availability', async () => {
    client.setQueryData(productAccessQueryKeys.list('org-a'), access('ACTIVE', 'org-a'));
    client.setQueryData(productAccessQueryKeys.list('org-b'), []);
    const f = surfaces();
    await f.assertAvailable(true);
    org.set('org-b');
    await f.assertAvailable(false);
    expect(await guard()).not.toBe(true);
    org.set('org-a');
    await f.assertAvailable(true);
    expect(await guard()).toBe(true);
  });
  it('onboarding cache hydration removes a previous unavailable state on every surface', async () => {
    client.setQueryData(productAccessQueryKeys.list(org()), []);
    const f = surfaces();
    await f.assertAvailable(false);
    client.setQueryData(productAccessQueryKeys.list(org()), access('ACTIVE'));
    await f.assertAvailable(true);
    expect(await guard()).toBe(true);
  });
  it('targeted ProductAccess invalidation refreshes availability without remounting pages', async () => {
    client.setQueryData(productAccessQueryKeys.list(org()), access('INACTIVE'));
    const f = surfaces();
    await f.assertAvailable(false);
    remote = access('ACTIVE');
    await client.invalidateQueries({ queryKey: productAccessQueryKeys.list(org()), exact: true });
    await f.assertAvailable(true);
    expect(await guard()).toBe(true);
    expect(listProductAccess).toHaveBeenCalledWith('org-a');
  });
});
