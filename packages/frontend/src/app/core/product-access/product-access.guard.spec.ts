import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';
import { ProductAccessQueries } from './product-access.queries';
import { productAccessGuard } from './product-access.guard';
import { routes } from '../routing/app.routes';

const timestamp = '2026-10-10T00:00:00.000Z';
function access(productCode: ProductCode): ProductAccess {
  return {
    orgId: 'org-a',
    productCode,
    status: 'ACTIVE',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
describe('RESTO-0 product route protection', () => {
  const fetchQuery = vi.fn();
  let orgId: string | null;
  const run = () => {
    const route = new ActivatedRouteSnapshot();
    route.data = { productCode: 'RESTAURANTS' };
    return TestBed.runInInjectionContext(() =>
      productAccessGuard(route, { url: '/restaurants' } as RouterStateSnapshot),
    );
  };
  beforeEach(() => {
    orgId = 'org-a';
    fetchQuery.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: { fetchQuery } },
        {
          provide: ProductAccessQueries,
          useValue: {
            activeOrgId: () => orgId,
            list: () => ({ queryKey: ['product-access', orgId] }),
          },
        },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it.each([
    ['RESTAURANTS'],
    ['ACCOUNTING', 'RESTAURANTS'],
    ['SALES', 'RESTAURANTS'],
    ['ACCOUNTING', 'SALES', 'RESTAURANTS'],
  ] satisfies ProductCode[][])('permits independent combination %j', async (...products) => {
    fetchQuery.mockResolvedValue(products.map(access));
    expect(await run()).toBe(true);
  });
  it.each([
    [],
    [access('SALES')],
    [access('ACCOUNTING')],
    [{ ...access('RESTAURANTS'), status: 'INACTIVE' }],
  ])('denies a missing/inactive RESTAURANTS entitlement %j', async (...products) => {
    fetchQuery.mockResolvedValue(products);
    expect(
      TestBed.inject(Router).serializeUrl((await run()) as ReturnType<Router['createUrlTree']>),
    ).toBe('/dashboard');
  });
  it('waits for access loading before allowing entry', async () => {
    let resolve!: (value: ProductAccess[]) => void;
    fetchQuery.mockReturnValue(
      new Promise<ProductAccess[]>((done) => {
        resolve = done;
      }),
    );
    let completed = false;
    const result = Promise.resolve(run()).then((value) => {
      completed = true;
      return value;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    resolve([access('RESTAURANTS')]);
    expect(await result).toBe(true);
  });
  it('denies on query error', async () => {
    fetchQuery.mockRejectedValue(new Error('Unavailable'));
    expect(await run()).not.toBe(true);
  });
  it('denies a workspace change while access is loading', async () => {
    fetchQuery.mockImplementation(async () => {
      orgId = 'org-b';
      return [access('RESTAURANTS')];
    });
    expect(await run()).not.toBe(true);
  });
  it('requires tenant context before fetching', async () => {
    orgId = null;
    expect(await run()).not.toBe(true);
    expect(fetchQuery).not.toHaveBeenCalled();
  });
  it('registers restaurants as a guarded top-level shell route outside sales', async () => {
    const shell = routes.find((route) =>
      route.children?.some((child) => child.path === 'restaurants'),
    );
    const route = shell?.children?.find((child) => child.path === 'restaurants');
    expect(route?.canActivate).toEqual([productAccessGuard]);
    expect(route?.data?.['productCode']).toBe('RESTAURANTS');
    expect(await route?.loadComponent?.()).toBeDefined();
    expect(shell?.canActivate?.length).toBeGreaterThan(0);
  });
});
