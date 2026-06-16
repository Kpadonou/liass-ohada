import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { AccountingApi } from './accounting.api';
import { AccountingQueries, accountingQueryKeys } from './accounting-queries';

describe('AccountingQueries', () => {
  let accountingApi: {
    getAccount: ReturnType<typeof vi.fn>;
    getJournal: ReturnType<typeof vi.fn>;
    listAccounts: ReturnType<typeof vi.fn>;
    listJournals: ReturnType<typeof vi.fn>;
  };
  let authStore: {
    activeDossierOrgId: ReturnType<typeof vi.fn>;
    activeWorkspaceOrgId: ReturnType<typeof vi.fn>;
    activeWorkspaceType: ReturnType<typeof vi.fn>;
  };
  let queries: AccountingQueries;

  beforeEach(() => {
    accountingApi = {
      getAccount: vi.fn(),
      getJournal: vi.fn(),
      listAccounts: vi.fn(),
      listJournals: vi.fn()
    };
    authStore = {
      activeDossierOrgId: vi.fn().mockReturnValue(null),
      activeWorkspaceOrgId: vi.fn().mockReturnValue('org-test'),
      activeWorkspaceType: vi.fn().mockReturnValue('COMPANY')
    };

    TestBed.configureTestingModule({
      providers: [
        AccountingQueries,
        { provide: AccountingApi, useValue: accountingApi },
        { provide: AuthStore, useValue: authStore }
      ]
    });

    queries = TestBed.inject(AccountingQueries);
  });

  it('keeps stable account query keys and typed query functions', async () => {
    accountingApi.listAccounts.mockResolvedValue({ items: [], hasMore: false });
    accountingApi.getAccount.mockResolvedValue({ accountId: '41100000' });

    const listOptions = queries.listAccounts({ limit: 25 });
    const detailOptions = queries.account('41100000');

    expect(accountingQueryKeys.accounts('org-test', { limit: 25 })).toEqual([
      'accounting',
      'org-test',
      'accounts',
      { cursor: null, limit: 25 }
    ]);
    expect(accountingQueryKeys.account('org-test', '41100000')).toEqual([
      'accounting',
      'org-test',
      'accounts',
      '41100000'
    ]);
    expect(listOptions.queryKey).toEqual([
      'accounting',
      'org-test',
      'accounts',
      { cursor: null, limit: 25 }
    ]);
    expect(detailOptions.queryKey).toEqual(['accounting', 'org-test', 'accounts', '41100000']);
    expect(detailOptions.enabled).toBe(true);
    expect(listOptions.staleTime).toBe(600_000);

    await (listOptions.queryFn as () => Promise<unknown>)();
    await (detailOptions.queryFn as () => Promise<unknown>)();

    expect(accountingApi.listAccounts).toHaveBeenCalledWith({ limit: 25 });
    expect(accountingApi.getAccount).toHaveBeenCalledWith('41100000');
  });

  it('disables account detail queries for invalid account ids', () => {
    expect(queries.account('ABC').enabled).toBe(false);
  });

  it('keeps stable journal query keys and typed query functions', async () => {
    accountingApi.listJournals.mockResolvedValue([]);
    accountingApi.getJournal.mockResolvedValue({ journalCode: 'VE' });

    const listOptions = queries.listJournals();
    const detailOptions = queries.journal('VE');

    expect(accountingQueryKeys.journals('org-test')).toEqual(['accounting', 'org-test', 'journals']);
    expect(accountingQueryKeys.journal('org-test', 'VE')).toEqual([
      'accounting',
      'org-test',
      'journals',
      'VE'
    ]);
    expect(listOptions.queryKey).toEqual(['accounting', 'org-test', 'journals']);
    expect(detailOptions.queryKey).toEqual(['accounting', 'org-test', 'journals', 'VE']);
    expect(detailOptions.enabled).toBe(true);
    expect(listOptions.staleTime).toBe(600_000);

    await (listOptions.queryFn as () => Promise<unknown>)();
    await (detailOptions.queryFn as () => Promise<unknown>)();

    expect(accountingApi.listJournals).toHaveBeenCalled();
    expect(accountingApi.getJournal).toHaveBeenCalledWith('VE');
  });

  it('disables journal detail queries for invalid journal codes', () => {
    expect(queries.journal('').enabled).toBe(false);
    expect(queries.journal('TOO-LONG-CODE').enabled).toBe(false);
  });

  it('uses the active dossier as accounting cache scope for accounting-firm workspaces', () => {
    authStore.activeWorkspaceType.mockReturnValue('ACCOUNTING_FIRM');
    authStore.activeWorkspaceOrgId.mockReturnValue('org-firm');
    authStore.activeDossierOrgId.mockReturnValue('org-client');

    expect(queries.tenantScope()).toBe('org-client');
    expect(queries.listAccounts().queryKey).toEqual([
      'accounting',
      'org-client',
      'accounts',
      { cursor: null, limit: 200 }
    ]);
  });
});
