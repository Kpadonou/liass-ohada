import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { AccountingApi } from './accounting.api';
import { AccountingFiscalYearContextService } from './accounting-fiscal-year-context.service';
import { AccountingQueries, accountingQueryKeys } from './accounting-queries';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn()
  };

  return globalScope.__liassAmplifyAuthMock;
});

describe('AccountingQueries', () => {
  let accountingApi: {
    getAccount: ReturnType<typeof vi.fn>;
    getEntryDetail: ReturnType<typeof vi.fn>;
    getGeneralLedger: ReturnType<typeof vi.fn>;
    getThirdPartyBalance: ReturnType<typeof vi.fn>;
    getThirdPartyLedger: ReturnType<typeof vi.fn>;
    getJournal: ReturnType<typeof vi.fn>;
    getJournalBook: ReturnType<typeof vi.fn>;
    getSummaryReport: ReturnType<typeof vi.fn>;
    getTrialBalance: ReturnType<typeof vi.fn>;
    listEntries: ReturnType<typeof vi.fn>;
    listAccounts: ReturnType<typeof vi.fn>;
    listJournals: ReturnType<typeof vi.fn>;
  };
  let fiscalYearContext: {
    activeFiscalYear: ReturnType<typeof vi.fn>;
    activeYear: ReturnType<typeof vi.fn>;
  };
  let authStore: {
    activeDossierOrgId: ReturnType<typeof vi.fn>;
    activeWorkspaceOrgId: ReturnType<typeof vi.fn>;
    activeWorkspaceType: ReturnType<typeof vi.fn>;
    effectiveAccountingOrgId: ReturnType<typeof vi.fn>;
  };
  let queries: AccountingQueries;

  beforeEach(() => {
    accountingApi = {
      getAccount: vi.fn(),
      getEntryDetail: vi.fn(),
      getGeneralLedger: vi.fn(),
      getThirdPartyBalance: vi.fn(),
      getThirdPartyLedger: vi.fn(),
      getJournal: vi.fn(),
      getJournalBook: vi.fn(),
      getSummaryReport: vi.fn(),
      getTrialBalance: vi.fn(),
      listEntries: vi.fn(),
      listAccounts: vi.fn(),
      listJournals: vi.fn()
    };
    fiscalYearContext = {
      activeFiscalYear: vi.fn().mockReturnValue({
        year: 2026,
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      }),
      activeYear: vi.fn().mockReturnValue(2026)
    };
    authStore = {
      activeDossierOrgId: vi.fn().mockReturnValue(null),
      activeWorkspaceOrgId: vi.fn().mockReturnValue('org-test'),
      activeWorkspaceType: vi.fn().mockReturnValue('COMPANY'),
      effectiveAccountingOrgId: vi.fn().mockReturnValue('org-test')
    };

    TestBed.configureTestingModule({
      providers: [
        AccountingQueries,
        { provide: AccountingApi, useValue: accountingApi },
        { provide: AccountingFiscalYearContextService, useValue: fiscalYearContext },
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
    authStore.effectiveAccountingOrgId.mockReturnValue('org-client');

    expect(queries.tenantScope()).toBe('org-client');
    expect(queries.listAccounts().queryKey).toEqual([
      'accounting',
      'org-client',
      'accounts',
      { cursor: null, limit: 100 }
    ]);
  });

  it('keeps entry list query keys scoped by tenant and active fiscal year', async () => {
    accountingApi.listEntries.mockResolvedValue({ items: [], hasMore: false });

    const options = queries.listEntriesForActiveFiscalYear({
      journalCode: 'OD',
      status: 'DRAFT',
      limit: 50
    });

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'entries',
      {
        cursor: null,
        journalCode: 'OD',
        limit: 50,
        month: null,
        status: 'DRAFT',
        year: '2026'
      }
    ]);
    expect(options.enabled).toBe(true);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.listEntries).toHaveBeenCalledWith({
      journalCode: 'OD',
      status: 'DRAFT',
      limit: 50,
      year: '2026'
    });
  });

  it('disables active fiscal year entries and detail queries when no fiscal year is selected', () => {
    fiscalYearContext.activeYear.mockReturnValue(null);

    expect(queries.listEntriesForActiveFiscalYear().enabled).toBe(false);
    expect(queries.entryDetail('E-123').enabled).toBe(false);
  });

  it('keeps entry detail query keys scoped by tenant and fiscal year', async () => {
    accountingApi.getEntryDetail.mockResolvedValue({ entryId: 'E-123' });

    const options = queries.entryDetail('E-123');

    expect(accountingQueryKeys.entryDetail('org-test', '2026', 'E-123')).toEqual([
      'accounting',
      'org-test',
      'entries',
      '2026',
      'E-123'
    ]);
    expect(options.queryKey).toEqual(['accounting', 'org-test', 'entries', '2026', 'E-123']);
    expect(options.enabled).toBe(true);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getEntryDetail).toHaveBeenCalledWith('E-123', '2026');
  });

  it('keeps paginated general ledger keys scoped by tenant, fiscal year, account, and cursor', async () => {
    accountingApi.getGeneralLedger.mockResolvedValue({
      accountId: '41100000',
      movements: [],
      hasMore: false
    });

    const options = queries.generalLedgerForActiveFiscalYear({
      accountId: '41100000',
      cursor: 'cursor-2',
      limit: 25
    });

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'general-ledger',
      {
        accountId: '41100000',
        cursor: 'cursor-2',
        endDate: null,
        fiscalYear: '2026',
        limit: 25,
        startDate: null
      }
    ]);
    expect(options.enabled).toBe(true);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getGeneralLedger).toHaveBeenCalledWith({
      accountId: '41100000',
      cursor: 'cursor-2',
      fiscalYear: '2026',
      limit: 25
    });
  });

  it('keeps auxiliary-ledger keys scoped by tenant, fiscal year, account, third party, type, and cursor', async () => {
    accountingApi.getThirdPartyLedger.mockResolvedValue({
      accountId: '41110000',
      thirdPartyId: 'tp-cust-alpha',
      thirdPartyType: 'CUSTOMER',
      movements: [],
      hasMore: false
    });

    const params = {
      fiscalYear: '2026',
      accountId: '41110000',
      thirdPartyId: 'tp-cust-alpha',
      thirdPartyType: 'CUSTOMER' as const,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      limit: 25,
      cursor: 'cursor-2'
    };
    const options = queries.thirdPartyLedger(params);

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'third-party-ledger',
      {
        accountId: '41110000',
        cursor: 'cursor-2',
        endDate: '2026-12-31',
        fiscalYear: '2026',
        limit: 25,
        startDate: '2026-01-01',
        thirdPartyId: 'tp-cust-alpha',
        thirdPartyType: 'CUSTOMER'
      }
    ]);
    expect(options.enabled).toBe(true);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getThirdPartyLedger).toHaveBeenCalledWith(params);
  });

  it('keeps auxiliary-balance keys scoped by tenant, fiscal year, account, type, status, dates, cursor, and limit', async () => {
    accountingApi.getThirdPartyBalance.mockResolvedValue({
      accountId: '41110000',
      thirdPartyType: 'CUSTOMER',
      rows: [],
      summary: { thirdPartyCount: 0 },
      count: 0,
      hasMore: false
    });

    const params = {
      fiscalYear: '2026',
      accountId: '41110000',
      thirdPartyType: 'CUSTOMER' as const,
      status: 'ACTIVE' as const,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      limit: 100,
      cursor: 'cursor-2'
    };
    const options = queries.thirdPartyBalance(params);

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'third-party-balance',
      {
        accountId: '41110000',
        cursor: 'cursor-2',
        endDate: '2026-12-31',
        fiscalYear: '2026',
        limit: 100,
        startDate: '2026-01-01',
        status: 'ACTIVE',
        thirdPartyType: 'CUSTOMER'
      }
    ]);
    expect(options.enabled).toBe(true);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getThirdPartyBalance).toHaveBeenCalledWith(params);
  });

  it('uses the active fiscal year for the six-column trial balance', async () => {
    accountingApi.getTrialBalance.mockResolvedValue({ rows: [], totals: {} });

    const options = queries.trialBalanceForActiveFiscalYear();

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'trial-balance',
      {
        accountClass: null,
        accountFrom: null,
        accountPrefix: null,
        accountTo: null,
        endDate: '2026-12-31',
        hideZeroMovement: false,
        startDate: '2026-01-01',
        year: '2026'
      }
    ]);
    expect(options.enabled).toBe(true);
    expect(options.retry).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getTrialBalance).toHaveBeenCalledWith({
      year: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    });
  });

  it('creates a manual tenant-scoped summary report query key with every expensive filter', async () => {
    accountingApi.getSummaryReport.mockResolvedValue({
      period: { fiscalYear: '2026', startDate: '2026-03-01', endDate: '2026-06-30' },
      trialBalance: { totalDebit: 0, totalCredit: 0, isBalanced: true },
      income: { totalRevenue: 0, totalExpense: 0, netResult: 0 }
    });

    const params = {
      fiscalYear: '2026',
      startDate: '2026-03-01',
      endDate: '2026-06-30',
      includeAuxiliary: true,
      includeClosingChecks: false
    };
    const options = queries.summaryReport(params);

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'summary-report',
      {
        endDate: '2026-06-30',
        fiscalYear: '2026',
        includeAuxiliary: true,
        includeClosingChecks: false,
        startDate: '2026-03-01'
      }
    ]);
    expect(options.enabled).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(5 * 60_000);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getSummaryReport).toHaveBeenCalledWith(params);
  });

  it('creates a tenant-scoped global journal-book key with all filters', async () => {
    accountingApi.getJournalBook.mockResolvedValue({
      items: [],
      meta: { year: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
      totals: { totalDebit: 0, totalCredit: 0, difference: 0, isBalanced: true, entryCount: 0, lineCount: 0 },
      integrityWarnings: [],
      hasMore: false
    });

    const options = queries.journalBookForActiveFiscalYear({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      journalCode: ' ve ',
      cursor: 'cursor-2',
      limit: 20
    });

    expect(options.queryKey).toEqual([
      'accounting',
      'org-test',
      'journal-book',
      {
        cursor: 'cursor-2',
        endDate: '2026-12-31',
        entryNumber: null,
        journalCode: 'VE',
        limit: 20,
        reference: null,
        accountPrefix: null,
        startDate: '2026-01-01',
        year: '2026'
      }
    ]);
    expect(options.enabled).toBe(true);

    await (options.queryFn as () => Promise<unknown>)();

    expect(accountingApi.getJournalBook).toHaveBeenCalledWith({
      journalCode: 'VE',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      cursor: 'cursor-2',
      limit: 20,
      year: '2026'
    });
  });

  it('disables Lot 4 active-year queries when no fiscal year is selected', () => {
    fiscalYearContext.activeYear.mockReturnValue(null);

    expect(
      queries.generalLedgerForActiveFiscalYear({ accountId: '41100000' }).enabled
    ).toBe(false);
    fiscalYearContext.activeFiscalYear.mockReturnValue(null);
    expect(queries.trialBalanceForActiveFiscalYear().enabled).toBe(false);
    expect(
      queries.journalBookForActiveFiscalYear({
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      }).enabled
    ).toBe(false);
  });
});
