import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { environment } from '../../../../../environments/environment';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { TrialBalanceExportService } from '../../utils/trial-balance-export';
import { TrialBalancePage } from './trial-balance.page';

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

const translations = {
  en: {
    ACCOUNTING: {
      TRIAL_BALANCE: {
        ACTIONS: {
          EXPORT_EXCEL: 'Export Excel',
          EXPORT_PDF: 'Export PDF',
          OPEN_LEDGER: 'Open ledger {{ account }}',
          RESET: 'Reset'
        },
        CONTROL: {
          BALANCED: 'Trial balance is balanced',
          BALANCED_TOOLTIP: 'Balanced',
          DIFFERENCES: 'Movement {{ movement }} closing {{ closing }}',
          UNBALANCED: 'Trial balance is unbalanced',
          UNBALANCED_WITH_DIFFERENCES: 'Unbalanced {{ movement }} {{ closing }}'
        },
        CURRENCY: 'Amounts in FCFA',
        EMPTY: { DESCRIPTION: 'Adjust filters', TITLE: 'No activity' },
        ERROR: { DESCRIPTION: 'Could not load', TITLE: 'Unavailable' },
        EXPORT: {
          FAILED: 'Export failed',
          FILTERS: 'Filters',
          FRAMEWORK: 'Framework',
          GENERATED_AT: 'Generated',
          ORGANIZATION_FALLBACK: 'Dossier',
          PERIOD: 'Period',
          SUCCESS_EXCEL: 'Excel generated',
          SUCCESS_PDF: 'PDF generated',
          TITLE: 'General trial balance'
        },
        EYEBROW: 'Trial balance',
        FILTERS: {
          ACCOUNT_FROM: 'First account',
          ACCOUNT_PREFIX: 'Account prefix',
          ACCOUNT_PREFIX_PLACEHOLDER: 'Search by account number',
          ACCOUNT_RANGE: 'Range',
          ACCOUNT_TO: 'Last account',
          ALL_CLASSES: 'All classes',
          CLASS: 'Class',
          CLASS_OPTION: 'Class {{ accountClass }}',
          DESCRIPTION: 'Scope',
          END_DATE: 'End date',
          HIDE_ZERO: 'Hide zero',
          START_DATE: 'Start date',
          TITLE: 'Scope',
          YEAR: 'Fiscal year'
        },
        LOADING: 'Loading',
        SUBTITLE: 'Review balances',
        TABLE: {
          ACCOUNT: 'Account',
          CLOSING: 'Closing',
          CLOSING_CREDIT: 'Closing credit',
          CLOSING_DEBIT: 'Closing debit',
          CREDIT: 'Credit',
          DEBIT: 'Debit',
          LABEL: 'Label',
          MOVEMENT_CREDIT: 'Movement credit',
          MOVEMENT_DEBIT: 'Movement debit',
          MOVEMENTS: 'Movements',
          OPENING: 'Opening',
          OPENING_CREDIT: 'Opening credit',
          OPENING_DEBIT: 'Opening debit',
          TITLE: 'General trial balance',
          TOTALS: 'Totals'
        },
        TITLE: 'Trial balance',
        VALIDATION: {
          ACCOUNT_RANGE: 'Invalid range',
          DATE_ORDER: 'Invalid date order',
          OUTSIDE_FISCAL_YEAR: 'Outside fiscal year',
          PERIOD_REQUIRED: 'Period required'
        }
      }
    },
    COMMON: { ACTIONS: { RETRY: 'Try again' } }
  }
};

describe('TrialBalancePage', () => {
  let fixture: ComponentFixture<TrialBalancePage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  const notification = {
    success: vi.fn(),
    error: vi.fn()
  };
  const exportService = {
    excel: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(undefined)
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [
        TrialBalancePage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: NotificationService, useValue: notification },
        { provide: TrialBalanceExportService, useValue: exportService },
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      { orgId: 'org-company-1', displayName: 'Demo SARL', workspaceType: 'COMPANY' },
      'org-company-1'
    );
    const fiscalYearContext = TestBed.inject(AccountingFiscalYearContextService);
    const fiscalYear = {
      year: 2026,
      fiscalYearId: 'FY-2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN' as const,
      accountingFramework: 'SYSCOHADA_REVISED' as const
    };
    fiscalYearContext.rememberFiscalYear(fiscalYear);
    fiscalYearContext.selectFiscalYear(fiscalYear);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('initializes from the active fiscal year and renders labels, amounts, totals, and balanced status', async () => {
    createPage();
    const request = expectBalanceRequest();
    expect(request.request.params.get('year')).toBe('2026');
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    request.flush(balanceResponse());
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('40110000');
    expect(text).toContain('Fournisseurs');
    expect(text).toContain('150\u202f000');
    expect(text).toContain('Trial balance is balanced');
    expect(text).toContain('Amounts in FCFA');

    const headerRows = fixture.nativeElement.querySelectorAll('thead tr');
    expect(headerRows).toHaveLength(2);
    expect(headerRows[0].textContent).toContain('Account');
    expect(headerRows[0].textContent).toContain('Label');
    expect(headerRows[0].textContent).toContain('Opening');
    expect(headerRows[0].textContent).toContain('Movements');
    expect(headerRows[0].textContent).toContain('Closing');
  });

  it('validates an inverted period inline and does not issue a query', async () => {
    createPage();
    expectBalanceRequest().flush(balanceResponse());
    await settle(fixture);

    const component = fixture.componentInstance as any;
    component.filterForm.controls.startDate.setValue('2026-06-30');
    component.filterForm.controls.endDate.setValue('2026-06-01');
    await wait(320);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Invalid date order');
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/books/trial-balance`);
  });

  it('debounces account prefix filtering and includes it in the next request', async () => {
    createPage();
    expectBalanceRequest().flush(balanceResponse());
    await settle(fixture);

    const component = fixture.componentInstance as any;
    component.filterForm.controls.accountPrefix.setValue('401');
    await wait(100);
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/books/trial-balance`);
    await wait(220);

    const request = expectBalanceRequest();
    expect(request.request.params.get('accountPrefix')).toBe('401');
    request.flush(balanceResponse());
  });

  it('opens the period-scoped general ledger and exports the complete report', async () => {
    createPage();
    expectBalanceRequest().flush(balanceResponse());
    await settle(fixture);

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance as any;
    component.openGeneralLedger('40110000');
    expect(navigate).toHaveBeenCalledWith(['/accounting/general-ledger'], {
      queryParams: {
        account: '40110000',
        year: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      }
    });

    await component.exportExcel();
    await component.exportPdf();
    expect(exportService.excel).toHaveBeenCalledWith(
      expect.objectContaining({ rows: expect.arrayContaining([expect.objectContaining({ accountCode: '40110000' })]) }),
      expect.any(Object),
      expect.any(Object)
    );
    expect(exportService.pdf).toHaveBeenCalled();
  });

  function createPage(): void {
    fixture = TestBed.createComponent(TrialBalancePage);
    fixture.detectChanges();
  }

  function expectBalanceRequest() {
    return httpMock.expectOne(
      (request) => request.url === `${apiBaseUrl}/books/trial-balance`
    );
  }
});

function balanceResponse() {
  return {
    data: {
      rows: [
        {
          accountCode: '40110000',
          accountLabel: 'Fournisseurs',
          openingDebit: 100000,
          openingCredit: 0,
          movementDebit: 50000,
          movementCredit: 50000,
          closingDebit: 100000,
          closingCredit: 0
        }
      ],
      totals: {
        openingDebit: 100000,
        openingCredit: 100000,
        movementDebit: 50000,
        movementCredit: 50000,
        closingDebit: 150000,
        closingCredit: 150000,
        isMovementBalanced: true,
        isClosingBalanced: true,
        movementDifference: 0,
        closingDifference: 0
      },
      period: {
        fiscalYear: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      }
    }
  };
}

async function settle(fixture: ComponentFixture<TrialBalancePage>): Promise<void> {
  await wait(20);
  TestBed.flushEffects();
  fixture.detectChanges();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
