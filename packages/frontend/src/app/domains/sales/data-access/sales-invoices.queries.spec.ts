import { TestBed } from '@angular/core/testing';
import type { SalesInvoiceListResponse } from '@liass-ohada/shared/sales';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesInvoicesApi } from './sales-invoices.api';
import { SalesInvoicesQueries, salesInvoiceQueryKeys } from './sales-invoices.queries';

describe('SalesInvoicesQueries', () => {
  const api = { list: vi.fn(async (): Promise<SalesInvoiceListResponse> => ({ items: [] })), get: vi.fn() };

  beforeEach(() => TestBed.configureTestingModule({ providers: [
    { provide: AuthStore, useValue: { effectiveOrgId: () => 'org-effective' } },
    { provide: SalesInvoicesApi, useValue: api }
  ] }));

  it('scopes invoice list/detail keys to effectiveOrgId and keeps cursor opaque', () => {
    const queries = TestBed.inject(SalesInvoicesQueries);
    expect(queries.rootKey()).toEqual(['sales', 'org-effective', 'invoices']);
    expect(queries.listRootKey()).toEqual(['sales', 'org-effective', 'invoices', 'list']);
    expect(queries.detailKey('INV-1')).toEqual(['sales', 'org-effective', 'invoices', 'INV-1']);
    expect(queries.list({ limit: 50, cursor: 'opaque+/=' }).queryKey).toEqual([
      'sales', 'org-effective', 'invoices', 'list', { cursor: 'opaque+/=', limit: 50 }
    ]);
  });

  it('cannot share a cursor cache entry across organizations', () => {
    expect(salesInvoiceQueryKeys.list('org-a', { cursor: 'same' })).not.toEqual(
      salesInvoiceQueryKeys.list('org-b', { cursor: 'same' })
    );
  });
});
