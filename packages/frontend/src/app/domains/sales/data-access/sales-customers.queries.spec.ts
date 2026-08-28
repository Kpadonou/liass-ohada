import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesCustomersApi } from './sales-customers.api';
import { SalesCustomersQueries, salesCustomerQueryKeys } from './sales-customers.queries';

describe('SalesCustomersQueries', () => {
  const api = {
    get: vi.fn(),
    list: vi.fn()
  };
  const authStore = {
    effectiveOrgId: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authStore.effectiveOrgId.mockReturnValue('org-sales');
    TestBed.configureTestingModule({
      providers: [
        SalesCustomersQueries,
        { provide: SalesCustomersApi, useValue: api },
        { provide: AuthStore, useValue: authStore }
      ]
    });
  });

  it('uses stable tenant-scoped keys and preserves the opaque cursor', async () => {
    api.list.mockResolvedValue({ items: [], nextCursor: 'opaque-next' });
    const queries = TestBed.inject(SalesCustomersQueries);
    const options = queries.list({ limit: 50, cursor: 'opaque-current' });

    expect(options.queryKey).toEqual([
      'sales',
      'org-sales',
      'customers',
      { cursor: 'opaque-current', limit: 50 }
    ]);
    expect(options.queryKey).toEqual(
      salesCustomerQueryKeys.list('org-sales', { limit: 50, cursor: 'opaque-current' })
    );
    await (options.queryFn as () => Promise<unknown>)();
    expect(api.list).toHaveBeenCalledWith({ limit: 50, cursor: 'opaque-current' });
  });

  it('keeps details under the same SALES customer root', async () => {
    api.get.mockResolvedValue({ id: 'SC-1' });
    const queries = TestBed.inject(SalesCustomersQueries);
    const options = queries.detail('SC-1');

    expect(queries.rootKey()).toEqual(['sales', 'org-sales', 'customers']);
    expect(options.queryKey).toEqual(['sales', 'org-sales', 'customers', 'SC-1']);
    await (options.queryFn as () => Promise<unknown>)();
    expect(api.get).toHaveBeenCalledWith('SC-1');
  });

  it('disables tenant-scoped queries when there is no effective organization', () => {
    authStore.effectiveOrgId.mockReturnValue(null);
    const queries = TestBed.inject(SalesCustomersQueries);

    expect(queries.list({ limit: 50 }).enabled).toBe(false);
    expect(queries.detail('SC-1').enabled).toBe(false);
  });
});
