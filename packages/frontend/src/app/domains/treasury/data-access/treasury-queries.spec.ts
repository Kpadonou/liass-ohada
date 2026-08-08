import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { TreasuryApi } from './treasury.api';
import { TreasuryQueries } from './treasury-queries';

describe('TreasuryQueries', () => {
  it('scopes query keys to the effective organization after a dossier switch', () => {
    const effectiveOrgId = vi.fn().mockReturnValue('org-client-a');
    TestBed.configureTestingModule({
      providers: [
        TreasuryQueries,
        { provide: TreasuryApi, useValue: {} },
        { provide: AuthStore, useValue: { effectiveOrgId } }
      ]
    });
    const queries = TestBed.inject(TreasuryQueries);

    expect(queries.accountsRootQueryKey()).toEqual([
      'treasury',
      'org-client-a',
      'accounts'
    ]);
    expect(queries.summaryRootQueryKey()).toEqual([
      'treasury',
      'org-client-a',
      'summary'
    ]);

    effectiveOrgId.mockReturnValue('org-client-b');
    expect(queries.accountsRootQueryKey()).toEqual([
      'treasury',
      'org-client-b',
      'accounts'
    ]);
    expect(queries.summaryRootQueryKey()).toEqual([
      'treasury',
      'org-client-b',
      'summary'
    ]);
  });
});
