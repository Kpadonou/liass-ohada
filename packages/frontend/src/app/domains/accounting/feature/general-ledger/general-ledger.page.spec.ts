import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { GeneralLedgerPage } from './general-ledger.page';

const translations = {
  en: {
    ACCOUNTING: {
      ACCOUNTS: {
        SELECT: {
          LABEL: 'Account',
          LOADING: 'Searching accounts...',
          LOAD_MORE: 'Load more accounts',
          MIN_CHARACTERS: 'Enter at least 2 characters.',
          NO_RESULTS: 'No accounts found',
          SEARCH_PLACEHOLDER: 'Search by account number',
          TYPE_TO_SEARCH: 'Type to search'
        }
      },
      FISCAL_YEAR_CONTEXT: {
        CHOOSE_ACTION: 'Choose fiscal year',
        CREATE_ACTION: 'Create fiscal year',
        EMPTY_DESCRIPTION: 'This feature needs an active fiscal year.',
        EMPTY_TITLE: 'Select a fiscal year'
      },
      GENERAL_LEDGER: {
        ACTIONS: {
          LOAD_MORE: 'Load more'
        },
        EMPTY: {
          DESCRIPTION: 'No posted movement is available.',
          SELECT_ACCOUNT_DESCRIPTION: 'Search for an account.',
          SELECT_ACCOUNT_TITLE: 'Select an account',
          TITLE: 'No movements for this account'
        },
        ERRORS: {
          ACCOUNTS_LOAD_FAILED: 'The chart of accounts could not be loaded.',
          LOAD_FAILED: 'The general ledger could not be loaded.',
          LOAD_MORE_FAILED: 'The next movements could not be loaded.'
        },
        EYEBROW: 'General ledger',
        FILTERS: {
          ACCOUNT: 'Account',
          ACCOUNT_SEARCH: 'Search by number or label',
          DESCRIPTION: 'Review an account’s movements.',
          NO_ACCOUNT_RESULTS: 'No account matches this search.',
          TITLE: 'Scope',
          YEAR: 'Fiscal year'
        },
        LOADING: 'Loading general-ledger movements...',
        METRICS: {
          FINAL: 'Final balance',
          MOVEMENTS: 'Movements',
          OPENING: 'Opening balance'
        },
        SUBTITLE: 'Track movements by account with running balance.',
        TABLE: {
          BALANCE: 'Balance',
          CREDIT: 'Credit',
          DATE: 'Date',
          DEBIT: 'Debit',
          DESCRIPTION: 'Posted movements.',
          JOURNAL: 'Journal',
          LABEL: 'Label',
          REFERENCE: 'Voucher / reference',
          TITLE: 'Movements'
        },
        TITLE: 'General ledger'
      }
    },
    COMMON: {
      ACTIONS: {
        CANCEL: 'Cancel',
        CLOSE: 'Close',
        RETRY: 'Try again',
        SAVE: 'Save'
      },
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      },
      TABLE: {
        HIDDEN_COLUMN: 'Hidden',
        LOCKED_COLUMN: 'Locked',
        PREFERENCES_EYEBROW: 'Table',
        PREFERENCES_TITLE: 'Preferences',
        REQUIRED_COLUMN: 'Required',
        RESET_PREFERENCES: 'Reset',
        VISIBLE_COLUMN: 'Visible',
        VISIBLE_COLUMNS: 'Visible columns',
        VISIBLE_COLUMNS_DESCRIPTION: 'Choose the columns shown in this table.'
      }
    }
  }
};

describe('GeneralLedgerPage', () => {
  let fixture: ComponentFixture<GeneralLedgerPage>;
  let httpMock: HttpTestingController;
  let queryParams: Record<string, string>;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    queryParams = {};

    await TestBed.configureTestingModule({
      imports: [
        GeneralLedgerPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useFactory: () => ({
            queryParamMap: of(convertToParamMap(queryParams))
          })
        },
        provideTanStackQuery(
          new QueryClient({
            defaultOptions: {
              queries: {
                retry: false
              }
            }
          })
        ),
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company-1',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-1'
    );
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    localStorage.clear();
    httpMock.verify();
  });

  it('renders the Grand Livre route component with its searchable account selector', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();

    expect(fixture.nativeElement.textContent).toContain('General ledger');
    expect(fixture.nativeElement.textContent).toContain('Select an account');
    const accountInput = fixture.nativeElement.querySelector(
      '[data-testid="general-ledger-account-select"] input'
    ) as HTMLInputElement;
    expect(accountInput).toBeTruthy();
    expect(accountInput.placeholder).toBe('Search by account number');
  });

  it('shows the fiscal-year guard when no fiscal year is active', async () => {
    createPage();
    flushAccounts();
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Select a fiscal year');
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/books/general-ledger`);
  });

  it('selecting an account triggers the scoped general-ledger query and displays formatted lines', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();

    selectAccount('41100000');
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`);

    expect(request.request.params.get('fiscalYear')).toBe('2026');
    expect(request.request.params.get('accountId')).toBe('41100000');
    expect(request.request.params.get('limit')).toBe('50');
    request.flush(ledgerResponse());
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('VE');
    expect(text).toContain('FV-001');
    expect(text).toContain('Facture client');
    expect(text).toContain('125\u202f000');
    expect(text).toContain('150\u202f000');
  });

  it('preselects account and fiscal year from query params and loads the ledger automatically', async () => {
    queryParams = {
      account: '41100000',
      year: '2025',
      startDate: '2025-02-01',
      endDate: '2025-03-31'
    };
    createPage();

    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`
    );
    expect(request.request.params.get('fiscalYear')).toBe('2025');
    expect(request.request.params.get('accountId')).toBe('41100000');
    expect(request.request.params.get('startDate')).toBe('2025-02-01');
    expect(request.request.params.get('endDate')).toBe('2025-03-31');
    request.flush(ledgerResponse());
    await settle();

    const accountInput = fixture.nativeElement.querySelector(
      '[data-testid="general-ledger-account-select"] input'
    ) as HTMLInputElement;
    const yearInput = fixture.nativeElement.querySelector(
      'input[readonly]'
    ) as HTMLInputElement;

    expect(accountInput.value).toBe('41100000');
    expect(yearInput.value).toBe('2025');
    expect(fixture.nativeElement.textContent).toContain('Facture client');
  });

  it('loads only the next backend page with the returned cursor', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();
    selectAccount('41100000');
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`).flush(
      ledgerResponse({ hasMore: true, nextCursor: 'cursor-2' })
    );
    await settle();

    const component = fixture.componentInstance as unknown as { loadMore: () => Promise<void> };
    const loadPromise = component.loadMore();
    const request = httpMock.expectOne((candidate) =>
      candidate.url === `${apiBaseUrl}/books/general-ledger` &&
      candidate.params.get('cursor') === 'cursor-2'
    );
    request.flush(ledgerResponse({
      finalBalance: 175000,
      movements: [
        movementFixture({
          date: '2026-02-01',
          entryId: 'E-002',
          label: 'Règlement client',
          lineId: 'L-002',
          reference: 'RC-001',
          runningBalance: 175000
        })
      ]
    }));
    await loadPromise;
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Règlement client');
    expect(fixture.nativeElement.textContent).toContain('175\u202f000');
  });

  it('renders contextual empty and blocking error states', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();
    selectAccount('41100000');
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`).flush(
      ledgerResponse({ movements: [] })
    );
    await settle();

    expect(fixture.nativeElement.textContent).toContain('No movements for this account');

    selectAccount('51200000');
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`).flush(
      { message: { message: 'Ledger consultation is temporarily unavailable.' } },
      { status: 500, statusText: 'Server error' }
    );
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Ledger consultation is temporarily unavailable.');
    expect(fixture.nativeElement.textContent).not.toContain('No movements for this account');
  });

  it('shows a translated fallback instead of raw Zod validation details', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();
    selectAccount('41100000');
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`).flush({
      data: {
        accountId: '41100000',
        openingBalance: {
          label: 'Opening balance',
          debit: 0,
          credit: 0
        },
        movements: [],
        finalBalance: 0
      }
    });
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('The general ledger could not be loaded.');
    expect(text).not.toContain('expected');
    expect(text).not.toContain('invalid_type');
    expect(text).not.toContain('hasMore');
  });

  it('does not display persistence keys returned by the server', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();
    selectAccount('41100000');
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`).flush(
      ledgerResponse({
        PK: 'ORG#org-company-1#FY#2026',
        GSI1PK: 'ORG#org-company-1',
        entityType: 'LEDGER',
        movements: [
          {
            ...movementFixture(),
            SK: 'LINE#L-001',
            GSI2SK: 'TECHNICAL'
          }
        ]
      })
    );
    await settle();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Facture client');
    expect(text).not.toContain('ORG#');
    expect(text).not.toContain('LINE#');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
  });

  it('persists optional table-column preferences', async () => {
    selectFiscalYear();
    createPage();
    flushAccounts();
    await settle();
    selectAccount('41100000');
    httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/books/general-ledger`).flush(
      ledgerResponse()
    );
    await settle();

    const component = fixture.componentInstance as unknown as { openTablePreferences: () => void };
    component.openTablePreferences();
    fixture.detectChanges();
    await settle();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    expect(document.body.textContent).toContain('Preferences');
    dialogRef.close({
      visibleColumnIds: ['date', 'journal', 'label', 'debit', 'credit', 'balance']
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    const stored = JSON.parse(
      localStorage.getItem('liass.table-preferences.accounting.generalLedger') ?? '{}'
    ) as { visibleColumnIds?: string[] };
    expect(stored.visibleColumnIds).not.toContain('reference');
    expect(fixture.nativeElement.textContent).not.toContain('Voucher / reference');
  });

  function createPage(): void {
    fixture = TestBed.createComponent(GeneralLedgerPage);
    fixture.detectChanges();
  }

  function flushAccounts(): void {
    // The remote selector does not preload a fixed account page.
  }

  function selectAccount(accountId: string): void {
    const component = fixture.componentInstance as unknown as {
      updateSelectedAccount: (value: string) => void;
    };
    component.updateSelectedAccount(accountId);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 25));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
});

function selectFiscalYear(): void {
  TestBed.inject(AccountingFiscalYearContextService).selectFiscalYear({
    accountingFramework: 'SYSCOHADA_REVISED',
    endDate: '2026-12-31',
    fiscalYearId: 'FY#2026',
    startDate: '2026-01-01',
    status: 'OPEN',
    year: 2026
  });
}

function accountFixture(overrides: Record<string, unknown> = {}) {
  return {
    accountId: '41100000',
    accountName: 'Clients',
    accountNature: 'BALANCE',
    accountUsage: 'BOTH',
    isThirdPartyAccount: true,
    classCode: 4,
    financialStatementCode: 'ACTIF',
    allowReconciliation: true,
    isActive: true,
    ...overrides
  };
}

function movementFixture(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-01-15',
    label: 'Facture client',
    reference: 'FV-001',
    journalCode: 'VE',
    entryId: 'E-001',
    lineId: 'L-001',
    debit: 125000,
    credit: 0,
    runningBalance: 150000,
    ...overrides
  };
}

function ledgerResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      accountId: '41100000',
      openingBalance: {
        date: '2026-01-01',
        label: 'Opening balance',
        debit: 25000,
        credit: 0,
        balance: 25000
      },
      movements: [movementFixture()],
      finalBalance: 150000,
      hasMore: false,
      ...overrides
    }
  };
}
