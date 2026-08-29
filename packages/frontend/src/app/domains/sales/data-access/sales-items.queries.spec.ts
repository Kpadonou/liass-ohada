import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesItemsApi } from './sales-items.api';
import { SalesItemsQueries, salesItemQueryKeys } from './sales-items.queries';

describe('SalesItemsQueries', () => {
  const api = { get: vi.fn(), list: vi.fn() };
  const authStore = { effectiveOrgId: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    authStore.effectiveOrgId.mockReturnValue('org-sales');
    TestBed.configureTestingModule({
      providers: [
        SalesItemsQueries,
        { provide: SalesItemsApi, useValue: api },
        { provide: AuthStore, useValue: authStore }
      ]
    });
  });

  it('uses stable tenant-scoped keys and preserves the opaque cursor', async () => {
    api.list.mockResolvedValue({ items: [], nextCursor: 'opaque-next' });
    const queries = TestBed.inject(SalesItemsQueries);
    const options = queries.list({ limit: 50, cursor: 'opaque-current' });
    expect(options.queryKey).toEqual(['sales', 'org-sales', 'items', { cursor: 'opaque-current', limit: 50 }]);
    expect(options.queryKey).toEqual(salesItemQueryKeys.list('org-sales', { limit: 50, cursor: 'opaque-current' }));
    await (options.queryFn as () => Promise<unknown>)();
    expect(api.list).toHaveBeenCalledWith({ limit: 50, cursor: 'opaque-current' });
  });

  it('keeps details under the same SALES item root', async () => {
    api.get.mockResolvedValue({ id: 'SI-1' });
    const queries = TestBed.inject(SalesItemsQueries);
    const options = queries.detail('SI-1');
    expect(queries.rootKey()).toEqual(['sales', 'org-sales', 'items']);
    expect(options.queryKey).toEqual(['sales', 'org-sales', 'items', 'SI-1']);
    await (options.queryFn as () => Promise<unknown>)();
    expect(api.get).toHaveBeenCalledWith('SI-1');
  });

  it('disables tenant-scoped queries without an effective organization', () => {
    authStore.effectiveOrgId.mockReturnValue(null);
    const queries = TestBed.inject(SalesItemsQueries);
    expect(queries.list({ limit: 50 }).enabled).toBe(false);
    expect(queries.detail('SI-1').enabled).toBe(false);
  });
});
