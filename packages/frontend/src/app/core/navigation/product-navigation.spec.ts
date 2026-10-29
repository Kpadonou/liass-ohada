import { RestaurantOutletContext } from '../../domains/restaurants/data-access/restaurant-outlet-context';
import { provideRouter } from '@angular/router';
import { ProductAccessState } from '../product-access/product-access.state';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { SalesCapabilities } from '../../domains/sales/data-access/sales-capabilities';
import { ProductAccessApi } from '../product-access/product-access.api';
import { productAccessQueryKeys } from '../product-access/product-access.queries';
import { UiStore } from '../state/ui.store';
import {
  ShellProductNavigation,
  ShellRouteContext,
  shellProducts,
  productForPage,
} from './product-navigation';

// Exercise the real organization-scoped ProductAccess query with local responses only.
describe('ShellProductNavigation organization isolation', () => {
  const org = signal('a');
  const salesRead = signal(true);
  let client: QueryClient;
  const access = (orgId: string, productCode: ProductCode): ProductAccess => ({
    orgId,
    productCode,
    status: 'ACTIVE',
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it('clears old product choices while a new organization loads and rejects late old responses', async () => {
    org.set('a');
    salesRead.set(true);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveB!: (value: ProductAccess[]) => void;
    const api = {
      listProductAccess: vi.fn((orgId: string) =>
        orgId === 'a'
          ? Promise.resolve([access('a', 'ACCOUNTING'), access('a', 'RESTAURANTS')])
          : new Promise<ProductAccess[]>((resolve) => {
              resolveB = resolve;
            }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RestaurantOutletContext,
          useValue: { id: () => 'active', available: () => true },
        },
        { provide: QueryClient, useValue: client },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: org,
            isAuthenticated: () => true,
            workspacesLoaded: () => true,
          },
        },
        { provide: UiStore, useValue: { currentPage: () => 'dashboard' } },
        { provide: SalesCapabilities, useValue: { canRead: salesRead } },
        { provide: ProductAccessApi, useValue: api },
      ],
    });
    const navigation = TestBed.inject(ShellProductNavigation);
    await vi.waitFor(() => {
      TestBed.tick();
      expect(navigation.products().map((product) => product.code)).toEqual([
        'ACCOUNTING',
        'RESTAURANTS',
      ]);
    });
    org.set('b');
    TestBed.tick();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(api.listProductAccess).toHaveBeenCalledWith('b');
    });
    expect(navigation.products()).toEqual([]);
    client.setQueryData(productAccessQueryKeys.list('a'), [access('a', 'RESTAURANTS')]);
    TestBed.tick();
    expect(navigation.products()).toEqual([]);
    resolveB([access('b', 'SALES')]);
    await vi.waitFor(() => {
      TestBed.tick();
      expect(navigation.products().map((product) => product.code)).toEqual(['SALES']);
    });
    // The recovery URL must not pretend to render Sales before it redirects.
    expect(navigation.activeProduct()).toBeNull();
    salesRead.set(false);
    TestBed.tick();
    expect(navigation.products()).toEqual([]);
  });
});

describe('Canonical product dashboards', () => {
  it('keeps explicit product landing routes and restores each route context', () => {
    expect(shellProducts.map((product) => [product.code, product.route])).toEqual([
      ['ACCOUNTING', '/dashboard'],
      ['SALES', '/sales'],
      ['RESTAURANTS', '/restaurants'],
    ]);
    expect(productForPage('dashboard')).toBe('ACCOUNTING');
    expect(productForPage('sales.dashboard')).toBe('SALES');
    expect(productForPage('restaurants')).toBe('RESTAURANTS');
    expect(productForPage('accounting.overview')).toBe('ACCOUNTING');
  });
});

describe('Restaurants shell framing by implemented member role', () => {
  afterEach(() => TestBed.resetTestingModule());
  it.each([
    [undefined, false],
    ['WAITER', true],
    ['OWNER', true],
    ['MANAGER', true],
    ['CASHIER', true],
    ['KITCHEN', true],
  ])('keeps a useful sidebar only for %s when supported', (role, visible) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RestaurantOutletContext,
          useValue: { id: () => 'active', available: () => true },
        },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace: () => ({
              orgId: 'org-a',
              workspaceType: 'COMPANY',
              productRoles: role ? { RESTAURANTS: role } : undefined,
            }),
            activeWorkspaceType: () => 'COMPANY',
            effectiveOrgId: () => 'org-a',
          },
        },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: UiStore, useValue: { currentPage: () => 'restaurants' } },
        { provide: SalesCapabilities, useValue: {} },
      ],
    });
    expect(TestBed.inject(ShellProductNavigation).hasSidebar()).toBe(visible);
  });
});

describe('Restaurants unresolved shell navigation', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('hides every sidebar family for an entitled manager until Active Outlet is validated', async () => {
    const ready = signal('');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RestaurantOutletContext, useValue: { id: ready, available: () => true } },
        { provide: ShellRouteContext, useValue: { url: () => '/restaurants/context' } },
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: () => 'org',
            activeWorkspace: () => ({ orgId: 'org', productRoles: { RESTAURANTS: 'OWNER' } }),
            activeWorkspaceType: () => 'COMPANY',
          },
        },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: UiStore, useValue: { currentPage: () => 'restaurants' } },
        { provide: SalesCapabilities, useValue: {} },
      ],
    });
    const navigation = TestBed.inject(ShellProductNavigation);
    expect(navigation.restaurantEntry()).toBe(true);
    expect(navigation.hasSidebar()).toBe(false);
    ready.set('outlet-a');
    expect(navigation.restaurantEntry()).toBe(false);
    expect(navigation.hasSidebar()).toBe(true);
  });
});
