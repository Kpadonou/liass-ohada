import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProductAccess } from '@liass-ohada/shared/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { ProductAccessApi } from './product-access.api';
import { resolveProductAvailability } from './product-availability';
import {
  PRODUCT_ACCESS_STALE_TIME,
  ProductAccessQueries,
  productAccessQueryKeys,
} from './product-access.queries';

describe('ProductAccessQueries', () => {
  const effectiveAccountingOrgId = signal<string | null>(null);
  const isAuthenticated = signal(false);
  const workspacesLoaded = signal(false);
  const listProductAccess = vi.fn();

  beforeEach(() => {
    effectiveAccountingOrgId.set(null);
    isAuthenticated.set(false);
    workspacesLoaded.set(false);
    listProductAccess.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ProductAccessQueries,
        { provide: ProductAccessApi, useValue: { listProductAccess } },
        {
          provide: AuthStore,
          useValue: { effectiveAccountingOrgId, isAuthenticated, workspacesLoaded },
        },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('stays disabled until authentication, workspace discovery, and an active tenant exist', () => {
    const queries = TestBed.inject(ProductAccessQueries);

    expect(queries.list().enabled).toBe(false);
    isAuthenticated.set(true);
    effectiveAccountingOrgId.set('org-a');
    expect(queries.list().enabled).toBe(false);
    workspacesLoaded.set(true);
    expect(queries.list().enabled).toBe(true);
    expect(queries.list().staleTime).toBe(PRODUCT_ACCESS_STALE_TIME);
  });

  it('uses isolated organization query keys without previous-tenant placeholder data', async () => {
    isAuthenticated.set(true);
    workspacesLoaded.set(true);
    effectiveAccountingOrgId.set('org-a');
    const queries = TestBed.inject(ProductAccessQueries);
    const orgAOptions = queries.list();

    expect(orgAOptions.queryKey).toEqual(productAccessQueryKeys.list('org-a'));
    expect(orgAOptions.placeholderData).toBeUndefined();

    effectiveAccountingOrgId.set('org-b');
    const orgBOptions = queries.list();
    expect(orgBOptions.queryKey).toEqual(productAccessQueryKeys.list('org-b'));
    expect(orgBOptions.queryKey).not.toEqual(orgAOptions.queryKey);

    listProductAccess.mockResolvedValue([]);
    await orgBOptions.queryFn?.({} as never);
    expect(listProductAccess).toHaveBeenCalledWith('org-b');

    effectiveAccountingOrgId.set('org-a');
    expect(queries.list().queryKey).toEqual(orgAOptions.queryKey);
  });

  it('reuses only the cache entry belonging to the effective organization', () => {
    const queryClient = new QueryClient();
    const timestamp = '2026-08-07T10:00:00.000Z';
    const orgAAccess: ProductAccess[] = [
      {
        orgId: 'org-a',
        productCode: 'TREASURY',
        status: 'ACTIVE',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    const orgBAccess: ProductAccess[] = [
      {
        orgId: 'org-b',
        productCode: 'TREASURY',
        status: 'INACTIVE',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    queryClient.setQueryData(productAccessQueryKeys.list('org-a'), orgAAccess);
    queryClient.setQueryData(productAccessQueryKeys.list('org-b'), orgBAccess);

    const cachedOrgB = queryClient.getQueryData<ProductAccess[]>(
      productAccessQueryKeys.list('org-b'),
    );
    expect(resolveProductAvailability(cachedOrgB, 'TREASURY', true)).toBe('UNAVAILABLE');

    const cachedOrgA = queryClient.getQueryData<ProductAccess[]>(
      productAccessQueryKeys.list('org-a'),
    );
    expect(resolveProductAvailability(cachedOrgA, 'TREASURY', true)).toBe('AVAILABLE');
  });
});
