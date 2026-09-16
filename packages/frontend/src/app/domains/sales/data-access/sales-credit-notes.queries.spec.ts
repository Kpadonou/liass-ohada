import { TestBed } from '@angular/core/testing';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesCreditNotesApi } from './sales-credit-notes.api';
import { SalesCreditNotesQueries, salesCreditNoteQueryKeys } from './sales-credit-notes.queries';

describe('SalesCreditNotesQueries', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [
    { provide: AuthStore, useValue: { effectiveOrgId: () => 'org-effective' } },
    { provide: SalesCreditNotesApi, useValue: { list: () => Promise.resolve(), get: () => Promise.resolve() } }
  ] }));

  it('scopes list and detail keys by effective tenant and source invoice', () => {
    const queries = TestBed.inject(SalesCreditNotesQueries);
    expect(queries.rootKey('INV-1')).toEqual(['sales', 'org-effective', 'invoices', 'INV-1', 'credit-notes']);
    expect(queries.detailKey('INV-1', 'CN-1')).toEqual(['sales', 'org-effective', 'invoices', 'INV-1', 'credit-notes', 'CN-1']);
    expect(queries.list('INV-1', { limit: 25, cursor: 'opaque+/=' }).queryKey).toEqual([
      'sales', 'org-effective', 'invoices', 'INV-1', 'credit-notes', { cursor: 'opaque+/=', limit: 25 }
    ]);
  });

  it('does not share credit note cache entries across tenants or invoices', () => {
    expect(salesCreditNoteQueryKeys.detail('org-a', 'INV-1', 'CN-1')).not.toEqual(salesCreditNoteQueryKeys.detail('org-b', 'INV-1', 'CN-1'));
    expect(salesCreditNoteQueryKeys.list('org-a', 'INV-1', {})).not.toEqual(salesCreditNoteQueryKeys.list('org-a', 'INV-2', {}));
  });

  it('disables list and detail reads when the caller is not eligible', () => {
    const queries = TestBed.inject(SalesCreditNotesQueries);
    expect(queries.list('INV-1', {}, false).enabled).toBe(false);
    expect(queries.detail('INV-1', 'CN-1', false).enabled).toBe(false);
  });
});
