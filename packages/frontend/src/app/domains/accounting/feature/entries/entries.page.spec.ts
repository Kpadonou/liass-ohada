import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { EntriesPage } from './entries.page';

const translations = {
  en: {
    ACCOUNTING: {
      ENTRIES: {
        ACTIONS: {
          ADD_LINE: 'Add line',
          CLEAR_FILTERS: 'Reset',
          LOAD_MORE: 'Load more',
          NEW_ENTRY: 'New entry',
          NEW_ENTRY_NOTICE: 'Full entry input will open in a dedicated workflow.',
          POST: 'Post',
          REMOVE_LINE: 'Remove',
          RETRY: 'Try again',
          VIEW_DETAILS: 'View details',
          VIEW_DETAILS_NOTICE: 'Entry details will be available in the next step.'
        },
        EMPTY: {
          DESCRIPTION: 'No entries are available.',
          NO_RESULTS_DESCRIPTION: 'Adjust filters.',
          NO_RESULTS_TITLE: 'No entries match the filters',
          TITLE: 'No entries loaded'
        },
        EYEBROW: 'Journal entry',
        FIELDS: {
          ACCOUNT: 'Account',
          CREDIT: 'Credit',
          DATE: 'Date',
          DEBIT: 'Debit',
          JOURNAL: 'Journal',
          LABEL: 'Label',
          LINE_LABEL: 'Line label',
          VOUCHER: 'Voucher',
          YEAR: 'Fiscal year'
        },
        FILTERS: {
          ALL_JOURNALS: 'All journals',
          ALL_MONTHS: 'All months',
          ALL_STATUSES: 'All statuses',
          JOURNAL: 'Journal',
          MONTH: 'Month',
          SEARCH: 'Search',
          STATUS: 'Status',
          YEAR: 'Fiscal year'
        },
        LIST: {
          DESCRIPTION: 'Review entries.',
          TITLE: 'Entries list'
        },
        LOADING: 'Loading entries...',
        LOAD_MORE_ERROR: 'The next entries could not be loaded.',
        POST: {
          DESCRIPTION: 'Entries must balance.',
          TITLE: 'New entry'
        },
        STATUS: {
          CANCELLED: 'Cancelled',
          DRAFT: 'Draft',
          POSTED: 'Posted'
        },
        SUBTITLE: 'Review entries.',
        TABLE: {
          ACTIONS: 'Actions',
          CREDIT: 'Credit',
          DATE: 'Date',
          DEBIT: 'Debit',
          JOURNAL: 'Journal',
          LABEL: 'Label',
          REFERENCE: 'Voucher',
          STATUS: 'Status'
        },
        TITLE: 'Entries',
        TOTALS: {
          BALANCED: 'Balanced',
          CREDIT: 'Total credit',
          DEBIT: 'Total debit',
          UNBALANCED: 'Unbalanced'
        },
        VALIDATION: {
          UNBALANCED: 'Total debit must equal total credit.'
        }
      },
      ERRORS: {
        LOAD_FAILED: 'Accounting data could not be loaded.',
        POST_ENTRY_FAILED: 'Entry could not be posted.'
      },
      FISCAL_YEAR_CONTEXT: {
        CHOOSE_ACTION: 'Choose fiscal year',
        CREATE_ACTION: 'Create fiscal year',
        EMPTY_DESCRIPTION: 'This feature needs an active fiscal year.',
        EMPTY_TITLE: 'Select a fiscal year',
        GO_TO_FISCAL_YEARS: 'Manage fiscal years'
      },
      JOURNALS: {
        TYPES: {
          MISC: 'Miscellaneous'
        }
      }
    },
    COMMON: {
      ACTIONS: {
        CANCEL: 'Cancel',
        CLOSE: 'Close',
        SAVE: 'Save'
      },
      TABLE: {
        ACTION_MENU: 'Open row actions',
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

describe('EntriesPage', () => {
  let fixture: ComponentFixture<EntriesPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        EntriesPage,
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
          useValue: {
            queryParamMap: of(convertToParamMap({}))
          }
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

  it('renders the existing entries route foundation with an active fiscal year', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, [entryFixture()]);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Entries');
    expect(fixture.nativeElement.textContent).toContain('Entries list');
    expect(fixture.nativeElement.textContent).toContain('New entry');
  });

  it('shows the fiscal-year guard and does not load entries when no fiscal year is active', async () => {
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushReferenceQueries(httpMock, apiBaseUrl);
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/entries`);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Select a fiscal year');
  });

  it('shows loading feedback before rendering entries', () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const loadingState = fixture.nativeElement.querySelector('[role="status"]');

    expect(text).toContain('Loading entries...');
    expect(text).not.toContain('No entries loaded');
    expect(loadingState?.getAttribute('aria-busy')).toBe('true');

    flushInitialQueries(httpMock, apiBaseUrl, []);
  });

  it('renders filters and backend-loaded entries for the active fiscal year', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, [
      entryFixture({
        entryId: 'ENTRY-001',
        entryDate: '2026-01-15',
        journalCode: 'VE',
        label: 'Vente client',
        totalCredit: 125000,
        totalDebit: 125000,
        voucherNumber: 'FAC-001'
      })
    ]);
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Search');
    expect(text).toContain('Journal');
    expect(text).toContain('Month');
    expect(text).toContain('Status');
    expect(text).toContain('VE');
    expect(text).toContain('FAC-001');
    expect(text).toContain('Vente client');
    expect(text).toContain('125\u202f000');
    expect(text).toContain('Posted');
  });

  it('renders the empty state after loading completes without entries', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, []);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('No entries loaded');
    expect(fixture.nativeElement.textContent).toContain('No entries are available.');
  });

  it('renders the no-result state after local search filters loaded entries', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, [
      entryFixture({ entryId: 'ENTRY-002', label: 'Achat fournisseur', journalCode: 'ACH' })
    ]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      searchQuery: { set: (value: string) => void };
    };
    component.searchQuery.set('vente introuvable');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No entries match the filters');
  });

  it('renders a separate error state with retry action', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushReferenceQueries(httpMock, apiBaseUrl);
    httpMock.expectOne((request) => request.url === `${apiBaseUrl}/entries`).flush(
      { message: 'Load failed' },
      { status: 500, statusText: 'Server error' }
    );
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Accounting data could not be loaded.');
    expect(fixture.nativeElement.textContent).toContain('Try again');
    expect(fixture.nativeElement.textContent).not.toContain('No entries loaded');
  });

  it('does not display technical persistence keys from entry responses', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, [
      {
        ...entryFixture({ entryId: 'ENTRY-TECH', label: 'Ecriture propre' }),
        PK: 'ORG#org-company-1#FY#2026',
        SK: 'ENTRY#ENTRY-TECH',
        GSI1PK: 'ACCOUNT#41100000',
        entityType: 'ENTRY'
      }
    ]);
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Ecriture propre');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI1PK');
    expect(text).not.toContain('entityType');
  });

  it('uses table preferences and a compact row action menu', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, [entryFixture()]);
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="entries-table-preferences"]')).toBeTruthy();

    const component = fixture.componentInstance as unknown as {
      openTablePreferences: () => void;
    };
    component.openTablePreferences();
    fixture.detectChanges();
    await settle(fixture);

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    expect(document.body.textContent).toContain('Preferences');
    dialogRef.close({ visibleColumnIds: ['date', 'journal', 'label', 'debit', 'credit', 'status', 'actions'] });
    await waitForDialogClose();
    await settle(fixture);

    const actionTrigger = fixture.nativeElement.querySelector('[data-testid="entry-row-actions"]') as HTMLButtonElement;
    actionTrigger.click();
    await settle(fixture);

    expect(document.body.textContent).toContain('View details');
    expect(document.body.querySelector('[data-testid="entry-view-action"] mat-icon')?.textContent?.trim()).toBe('visibility');
    expect(document.body.querySelector('[data-testid="entry-view-action"]')?.classList).toContain('liass-menu-action-neutral');
  });

  it('opens the dedicated new entry page from the primary action', async () => {
    selectFiscalYear();
    fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();

    flushInitialQueries(httpMock, apiBaseUrl, [entryFixture()]);
    await settle(fixture);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const button = [...fixture.nativeElement.querySelectorAll('button')].find((candidate: HTMLButtonElement) =>
      candidate.textContent?.includes('New entry')
    ) as HTMLButtonElement;
    button.click();
    await settle(fixture);

    expect(navigate).toHaveBeenCalledWith(['/accounting/entries/new']);
  });

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

function flushInitialQueries(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  entries: Record<string, unknown>[],
  hasMore = false
): void {
  flushReferenceQueries(httpMock, apiBaseUrl);

  httpMock.expectOne((request) => request.url === `${apiBaseUrl}/entries`).flush({
    data: {
      entries,
      hasMore,
      nextCursor: hasMore ? 'cursor-2' : undefined
    }
  });
}

function flushReferenceQueries(httpMock: HttpTestingController, apiBaseUrl: string): void {
  httpMock.expectOne((request) => request.url === `${apiBaseUrl}/journals`).flush({
    data: [
      {
        journalCode: 'VE',
        journalName: 'Ventes',
        type: 'SALE',
        year: 2026
      },
      {
        journalCode: 'ACH',
        journalName: 'Achats',
        type: 'PURCHASE',
        year: 2026
      }
    ]
  });
}

function entryFixture(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 'ENTRY-001',
    year: 2026,
    entryDate: '2026-01-10',
    journalCode: 'VE',
    voucherNumber: 'PJ-001',
    label: 'Vente comptabilisee',
    totalDebit: 100000,
    totalCredit: 100000,
    status: 'POSTED',
    ...overrides
  };
}

async function settle(fixture: ComponentFixture<EntriesPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 25));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function waitForDialogClose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
