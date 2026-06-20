import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { EntryDetailPage } from './entry-detail.page';

const translations = {
  en: {
    ACCOUNTING: {
      ENTRIES: {
        DETAIL: {
          ACTIONS: {
            EDIT: 'Edit',
            VIEW_GENERAL_LEDGER: 'View general ledger'
          },
          BACK_TO_LIST: 'Back to entries',
          ERROR: {
            DESCRIPTION: 'Try again or return to the entries list.',
            TITLE: 'The entry details could not be loaded'
          },
          EYEBROW: 'Accounting entry',
          LINES: {
            ACTIONS: 'Actions',
            ACCOUNT: 'Account',
            CREDIT: 'Credit',
            DEBIT: 'Debit',
            DESCRIPTION: 'Affected accounts and amounts.',
            EMPTY: 'No line is available for this entry.',
            LABEL: 'Label',
            THIRD_PARTY: 'Third party',
            TITLE: 'Entry lines'
          },
          NOTIFICATIONS: {
            GENERAL_LEDGER_ACCOUNT_REQUIRED: 'The line account is required to view the general ledger.',
            GENERAL_LEDGER_YEAR_REQUIRED: 'The entry fiscal year is required to view the general ledger.'
          },
          LOADING: 'Loading entry details...',
          METADATA: {
            DATE: 'Date',
            DESCRIPTION: 'Accounting document identification.',
            JOURNAL: 'Journal',
            LABEL: 'Label',
            REFERENCE: 'Voucher',
            TITLE: 'Entry information',
            TYPE: 'Type',
            YEAR: 'Fiscal year'
          },
          NOT_FOUND: {
            DESCRIPTION: 'This entry does not exist.',
            TITLE: 'Entry not found'
          },
          SUBTITLE: 'Review the entry information, totals and lines.',
          TITLE: 'Entry details',
          TOTALS: {
            CREDIT: 'Total credit',
            DEBIT: 'Total debit'
          },
          TYPES: {
            ADJUSTMENT: 'Adjustment',
            CLOSING: 'Closing',
            OPENING: 'Opening',
            STANDARD: 'Standard'
          }
        },
        STATUS: {
          CANCELLED: 'Cancelled',
          DRAFT: 'Draft',
          POSTED: 'Posted'
        }
      },
      FISCAL_YEAR_CONTEXT: {
        CHOOSE_ACTION: 'Choose fiscal year',
        CREATE_ACTION: 'Create fiscal year',
        EMPTY_DESCRIPTION: 'This feature needs an active fiscal year.',
        EMPTY_TITLE: 'Select a fiscal year',
        GO_TO_FISCAL_YEARS: 'Manage fiscal years'
      }
    },
    COMMON: {
      ACTIONS: {
        RETRY: 'Try again'
      }
    }
  }
};

describe('EntryDetailPage', () => {
  let fixture: ComponentFixture<EntryDetailPage>;
  let httpMock: HttpTestingController;
  let notification: {
    error: ReturnType<typeof vi.fn>;
  };
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    localStorage.clear();
    notification = {
      error: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        EntryDetailPage,
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
            snapshot: {
              paramMap: convertToParamMap({ entryId: 'ENTRY-001' })
            }
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
        { provide: NotificationService, useValue: notification },
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
    selectFiscalYear();
  });

  afterEach(() => {
    localStorage.clear();
    httpMock.verify();
  });

  it('loads the entry with its business id and active fiscal year', async () => {
    createPage();
    await waitForRequest();

    const request = expectDetailRequest();
    expect(request.request.params.get('year')).toBe('2026');
    request.flush({ data: entryFixture() });
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Entry details');
  });

  it('renders loading feedback before the detail response arrives', async () => {
    createPage();

    expect(fixture.nativeElement.textContent).toContain('Loading entry details...');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe(
      'true'
    );

    await waitForRequest();
    expectDetailRequest().flush({ data: entryFixture() });
  });

  it('displays entry metadata, totals and lines', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush({ data: entryFixture() });
    await settle();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Posted');
    expect(text).toContain('2026');
    expect(text).toContain('2026-03-18');
    expect(text).toContain('VE');
    expect(text).toContain('FAC-2026-018');
    expect(text).toContain('Vente de marchandises');
    expect(text).toContain('100\u202f000');
    expect(text).toContain('41100000');
    expect(text).toContain('Clients');
    expect(text).toContain('Client ABC');
    expect(text).toContain('70700000');
    expect(text).toContain('Ventes de marchandises');
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="entry-line-general-ledger"]').length
    ).toBe(2);
  });

  it('navigates from a specific entry line to its account general ledger and entry year', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush({ data: entryFixture() });
    await settle();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const action = fixture.nativeElement.querySelector(
      '[data-testid="entry-line-general-ledger"] button'
    ) as HTMLButtonElement;
    expect(action.getAttribute('aria-label')).toBe('View general ledger');
    action.click();
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/accounting/general-ledger'], {
      queryParams: {
        account: '41100000',
        year: 2026
      }
    });
  });

  it('shows the translated general-ledger hint on line action icons', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush({ data: entryFixture() });
    await settle();

    const tooltipActions = fixture.debugElement.queryAll(By.directive(MatTooltip));

    expect(tooltipActions).toHaveLength(2);
    expect(tooltipActions[0].injector.get(MatTooltip).message).toBe('View general ledger');
  });

  it('does not navigate without a safe line account or entry fiscal year', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush({ data: entryFixture() });
    await settle();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance as unknown as {
      viewGeneralLedger: (
        line: { accountId?: string },
        year?: number
      ) => Promise<void>;
    };

    await component.viewGeneralLedger({ accountId: '' }, 2026);
    await component.viewGeneralLedger({ accountId: '41100000' }, undefined);

    expect(navigate).not.toHaveBeenCalled();
    expect(notification.error).toHaveBeenCalledWith(
      'The line account is required to view the general ledger.'
    );
    expect(notification.error).toHaveBeenCalledWith(
      'The entry fiscal year is required to view the general ledger.'
    );
  });

  it('does not offer direct editing for a posted entry or display persistence keys', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush({
      data: {
        ...entryFixture(),
        PK: 'ORG#org-company-1#FY#2026',
        SK: 'ENTRY#ENTRY-001',
        GSI1PK: 'JOURNAL#VE',
        entityType: 'ENTRY'
      }
    });
    await settle();

    const text = fixture.nativeElement.textContent;

    expect(fixture.nativeElement.querySelector('[data-testid="entry-detail-edit"]')).toBeFalsy();
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI1PK');
    expect(text).not.toContain('entityType');
  });

  it('offers editing for a draft and navigates to the existing edit route', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush({ data: entryFixture({ status: 'DRAFT' }) });
    await settle();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const editButton = fixture.nativeElement.querySelector(
      '[data-testid="entry-detail-edit"] button'
    ) as HTMLButtonElement;
    editButton.click();
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/accounting/entries', 'ENTRY-001', 'edit']);
  });

  it('renders the contextual not-found state', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush(
      { message: 'Missing entry' },
      { status: 404, statusText: 'Not found' }
    );
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Entry not found');
    expect(fixture.nativeElement.textContent).not.toContain('Try again');
  });

  it('renders a blocking load error and prioritizes the backend message', async () => {
    createPage();
    await waitForRequest();
    expectDetailRequest().flush(
      { message: { code: 'ENTRY_LOAD_FAILED', message: 'Entry temporarily unavailable.' } },
      { status: 500, statusText: 'Server error' }
    );
    await settle();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('The entry details could not be loaded');
    expect(text).toContain('Entry temporarily unavailable.');
    expect(text).toContain('Try again');
  });

  function createPage(): void {
    fixture = TestBed.createComponent(EntryDetailPage);
    fixture.detectChanges();
  }

  function expectDetailRequest() {
    return httpMock.expectOne(
      (request) => request.url === `${apiBaseUrl}/entries/ENTRY-001`
    );
  }

  async function waitForRequest(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
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

function entryFixture(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 'ENTRY-001',
    year: 2026,
    entryDate: '2026-03-18',
    journalCode: 'VE',
    voucherNumber: 'FAC-2026-018',
    entryType: 'STANDARD',
    label: 'Vente de marchandises',
    totalDebit: 100000,
    totalCredit: 100000,
    status: 'POSTED',
    lines: [
      {
        lineId: 'LINE-001',
        accountId: '41100000',
        accountName: 'Clients',
        label: 'Client ABC',
        thirdPartyId: 'CLIENT-ABC',
        debit: 100000,
        credit: 0
      },
      {
        lineId: 'LINE-002',
        accountId: '70700000',
        accountName: 'Ventes de marchandises',
        label: 'Vente',
        debit: 0,
        credit: 100000
      }
    ],
    ...overrides
  };
}
