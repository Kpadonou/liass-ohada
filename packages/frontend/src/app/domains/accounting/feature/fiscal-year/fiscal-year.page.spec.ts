import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { FiscalYearPage } from './fiscal-year.page';

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
      NOTIFICATIONS: {
        FISCAL_YEAR_CREATED: 'Fiscal year created successfully.',
        PERIOD_LOCKED: 'Period locked.',
        PERIOD_UNLOCKED: 'Period unlocked.'
      },
      FISCAL_YEAR: {
        ACTIONS: {
          CLOSE_PREPARATION: 'Preparation coming',
          CREATE: 'New fiscal year',
          CREATE_SUBMIT: 'Create fiscal year',
          LOAD: 'Load',
          LOCK: 'Lock',
          NEW: 'New fiscal year',
          UNLOCK: 'Unlock'
        },
        CLOSE: {
          DESCRIPTION: 'Prepare closing.',
          HELP: 'Final close will be enabled later.',
          TITLE: 'Close preparation'
        },
        CREATE_DIALOG: {
          DESCRIPTION: 'Create the fiscal year.',
          EYEBROW: 'Fiscal year',
          TITLE: 'New fiscal year'
        },
        EMPTY: 'No fiscal year found.',
        ERRORS: {
          CREATE_FAILED: 'The fiscal year could not be created.',
          PERIOD_UPDATE_FAILED: 'The period could not be updated.'
        },
        NOT_FOUND: 'No fiscal year found for this year.',
        EYEBROW: 'Accounting period',
        FIELDS: {
          FRAMEWORK: 'Accounting framework',
          YEAR: 'Fiscal year'
        },
        MONTHS: {
          '01': 'January',
          '02': 'February',
          '03': 'March',
          '04': 'April',
          '05': 'May',
          '06': 'June',
          '07': 'July',
          '08': 'August',
          '09': 'September',
          '10': 'October',
          '11': 'November',
          '12': 'December'
        },
        PERIOD_STATUS: {
          LOCKED: 'Locked',
          OPEN: 'Open'
        },
        PERIODS: {
          DESCRIPTION: 'Control monthly periods.',
          MONTH_PREFIX: 'Month',
          NO_SELECTION: 'Load or create a fiscal year to display period locks.',
          READ_ONLY_CLOSED: 'Closed',
          TITLE: 'Period locks'
        },
        PERIOD_CONFIRM: {
          EYEBROW: 'Period lock',
          LOCK_DESCRIPTION: 'Confirm locking this period.',
          LOCK_TITLE: 'Lock this period?',
          UNLOCK_DESCRIPTION: 'Confirm reopening this period.',
          UNLOCK_TITLE: 'Unlock this period?'
        },
        SELECTOR: {
          DESCRIPTION: 'Enter the fiscal year to load or create.',
          IDLE: 'No fiscal year is loaded yet.',
          TITLE: 'Find or create a fiscal year'
        },
        STATUS: {
          ARCHIVED: 'Archived',
          CLOSED: 'Closed',
          LOCKED: 'Locked',
          OPEN: 'Open'
        },
        SUBTITLE: 'Manage fiscal-year status.',
        SUMMARY: {
          DESCRIPTION: 'Current status.',
          LOCKED_PERIODS: 'Locked',
          OPEN_PERIODS: 'Open',
          TITLE: 'Fiscal year status'
        },
        TITLE: 'Fiscal years'
      },
      CLOSING: {
        ACTIONS: {
          CLOSE_YEAR: 'Close fiscal year'
        },
        CHECKS: {
          ERRORS_TITLE: 'Corrections required',
          TITLE: 'Closing checks',
          WARNINGS_TITLE: 'Warnings to review'
        },
        CONFIRMATION: {
          ACKNOWLEDGE_WARNINGS: 'I have reviewed the warnings and confirm closing.',
          COPY: 'Closing will lock the fiscal year. Posted entries will remain readable, but no new posting will be possible in this fiscal year.',
          DIALOG_TITLE: 'Confirm fiscal-year close',
          EYEBROW: 'Confirmation',
          TITLE: 'Confirmation',
          WARNINGS_REQUIRED: 'Warnings must be acknowledged.'
        },
        DESCRIPTION: 'Review checks before close.',
        ERRORS: {
          CLOSE_FAILED: 'The fiscal year could not be closed.'
        },
        ISSUES: {
          ACCOUNT_AUXILIARY_CONFIGURATION_INVALID: 'Auxiliary configuration must be corrected.',
          ACCOUNT_INACTIVE: 'An account is inactive.',
          ACCOUNT_NOT_FOUND: 'An account could not be found.',
          AUXILIARY_THIRD_PARTY_REQUIRED: 'A third party is required.',
          AUXILIARY_THIRD_PARTY_TYPE_MISMATCH: 'Third-party type mismatch.',
          DRAFT_ENTRIES_REMAIN: 'Draft entries remain.',
          ENTRY_NOT_BALANCED: 'An entry is not balanced.',
          FISCAL_YEAR_NOT_OPEN: 'The fiscal year must be open.',
          GENERIC: 'A closing check must be reviewed.',
          JOURNAL_NOT_FOUND: 'A journal could not be found.',
          META: {
            ACCOUNT: 'Account {{accountId}}',
            ENTRY: 'Entry {{entryId}}',
            JOURNAL: 'Journal {{journalCode}}',
            LINE: 'Line {{lineId}}',
            THIRD_PARTY: 'Third party {{thirdPartyId}}'
          },
          TRIAL_BALANCE_NOT_BALANCED: 'The trial balance is not balanced.',
          UNLETTERED_AUXILIARY_LINES_REMAIN: 'Customer or supplier lines remain unlettered.',
          UNPOSTED_ENTRY_INCLUDED_IN_BOOKS: 'An unposted entry appears in the books.'
        },
        NOTIFICATIONS: {
          YEAR_CLOSED: 'Fiscal year closed successfully.'
        },
        PERIODS: {
          CLOSED_COUNT: '{{count}} closed',
          DESCRIPTION: 'Monthly cards remain the reference.',
          OPEN_COUNT: '{{count}} open',
          TITLE: 'Periods'
        },
        RESULT: {
          IDLE: 'The closing result will appear here after confirmation.',
          SUCCESS: 'Fiscal year {{year}} is closed.',
          TITLE: 'Result'
        },
        STATES: {
          ALREADY_CLOSED: 'This fiscal year is closed.',
          CHECKS_UNAVAILABLE: 'Closing checks could not be loaded.',
          CLOSED: 'This fiscal year is closed.',
          LOADING: 'Loading closing checks...',
          NO_SELECTION: 'No fiscal year selected.'
        },
        STATUS: {
          BLOCKED: 'Corrections required',
          CLOSED: 'Fiscal year closed',
          READY: 'Ready to close',
          UNAVAILABLE: 'Checks unavailable',
          WARNINGS: 'Warnings to review'
        },
        SUMMARY: {
          DRAFT_ENTRIES: 'Drafts',
          FISCAL_YEAR: 'Fiscal year',
          POSTED_ENTRIES: 'Posted entries',
          TRIAL_BALANCE_CREDIT: 'Total credit',
          TRIAL_BALANCE_DEBIT: 'Total debit',
          UNBALANCED_ENTRIES: 'Unbalanced entries',
          UNLETTERED_LINES: 'Unlettered lines'
        },
        TITLE: 'Closing assistant'
      }
    },
    COMMON: {
      ACTIONS: {
        CANCEL: 'Cancel'
      }
    },
    IDENTITY: {
      ONBOARDING: {
        FRAMEWORKS: {
          SYCEBNL: 'SYCEBNL',
          SYSCOHADA_REVISED: 'SYSCOHADA revised'
        }
      }
    }
  }
};

describe('FiscalYearPage', () => {
  let fixture: ComponentFixture<FiscalYearPage>;
  let httpMock: HttpTestingController;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  const currentYear = new Date().getFullYear();

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    snackBarOpen = vi.fn();

    await TestBed.configureTestingModule({
      imports: [
        FiscalYearPage,
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
        { provide: MatSnackBar, useValue: { open: snackBarOpen } },
        provideTanStackQuery(new QueryClient({
          defaultOptions: {
            queries: {
              retry: false
            }
          }
        })),
        { provide: WorkspacesApi, useValue: { listWorkspaces: () => Promise.resolve([]) } },
        { provide: CabinetDossiersApi, useValue: { listDossiers: () => Promise.resolve([]) } }
      ]
    }).compileComponents();

    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY',
        accountingFramework: 'SYSCOHADA_REVISED'
      },
      'org-company'
    );

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FiscalYearPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    httpMock.verify();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((element) => element.remove());
  });

  it('loads fiscal year details and renders the twelve periods', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '01': 'LOCKED' });
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Fiscal years');
    expect(text).toContain('January');
    expect(text).toContain('December');
    expect(text.match(/Month\s+\d{2}/g)?.length).toBe(12);
    expect(text).toContain('Locked');
    expect(text).toContain('Open');
  });

  it('does not activate the default input year before the fiscal year is loaded', async () => {
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    const yearInput = fixture.nativeElement.querySelector('input[formcontrolname="year"]') as HTMLInputElement;

    expect(TestBed.inject(AccountingFiscalYearContextService).activeYear()).toBeNull();
    expect(yearInput.value).toBe(`${currentYear}`);
    expect(text).toContain('No fiscal year is loaded yet.');
    expect(text).toContain('Load or create a fiscal year to display period locks.');
    expect(text).not.toContain('Month 01');
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}`);
  });

  it('selects the active fiscal year only after loading an existing backend fiscal year', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {});
    await settle(fixture);

    expect(TestBed.inject(AccountingFiscalYearContextService).activeYear()).toBe(currentYear);
    expect(fixture.nativeElement.textContent).toContain(`${currentYear}-01-01`);
  });

  it('shows a not-found state and hides period locks when the backend has no fiscal year', async () => {
    const component = fixture.componentInstance as unknown as {
      form: {
        controls: {
          year: {
            setValue: (value: number) => void;
          };
        };
      };
      loadSelectedYear: () => void;
    };
    component.form.controls.year.setValue(currentYear + 3);
    component.loadSelectedYear();
    fixture.detectChanges();

    httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear + 3}`).flush(
      { message: 'Not found' },
      { status: 404, statusText: 'Not Found' }
    );
    httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear + 3}/closing-checks`).flush(
      { message: 'Not found' },
      { status: 404, statusText: 'Not Found' }
    );
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(TestBed.inject(AccountingFiscalYearContextService).activeYear()).toBeNull();
    expect(text).toContain('No fiscal year found for this year.');
    expect(text).not.toContain('Month 01');
  });

  it('creates a fiscal year from a dialog and selects it after success', async () => {
    const component = fixture.componentInstance as unknown as {
      openCreateFiscalYear: () => void;
    };
    component.openCreateFiscalYear();
    fixture.detectChanges();

    expect(document.body.textContent).toContain('New fiscal year');
    expect(document.body.textContent).toContain('Create fiscal year');

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        setValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };
    dialogInstance.form.setValue({
      year: currentYear + 1
    });

    const submitPromise = dialogInstance.submit();
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({
      year: currentYear + 1
    });
    createRequest.flush({
      message: 'Backend says fiscal year created.',
      data: {
        accountingFramework: 'SYSCOHADA_REVISED',
        endDate: `${currentYear + 1}-12-31`,
        fiscalYearId: `FY#${currentYear + 1}`,
        startDate: `${currentYear + 1}-01-01`,
        status: 'OPEN',
        year: currentYear + 1
      }
    });
    await submitPromise;
    await waitForDialogClose();
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear + 1, {});
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain(`${currentYear + 1}-01-01`);
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Backend says fiscal year created.',
      undefined,
      expect.objectContaining({ panelClass: 'success-notification-overlay' })
    );
  });

  it('shows backend fiscal-year create errors before generic fallbacks', async () => {
    const component = fixture.componentInstance as unknown as {
      openCreateFiscalYear: () => void;
    };
    component.openCreateFiscalYear();
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        setValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };
    dialogInstance.form.setValue({
      year: currentYear
    });

    const submitPromise = dialogInstance.submit();
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year`);

    createRequest.flush(
      {
        message: {
          code: 'ERROR_FISCAL_YEAR_ALREADY_EXISTS',
          message: "L'exercice existe déjà."
        }
      },
      { status: 409, statusText: 'Conflict' }
    );
    await submitPromise;
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    expect(document.body.textContent).toContain("L'exercice existe déjà.");
    expect(document.body.textContent).not.toContain('The fiscal year could not be created.');
    expect(snackBarOpen).toHaveBeenCalledWith(
      "L'exercice existe déjà.",
      undefined,
      expect.objectContaining({ panelClass: 'error-notification-overlay' })
    );
  });

  it('replaces the preparation placeholder with a functional closing assistant', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {}, 'OPEN', cleanClosingChecks(currentYear));
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Closing assistant');
    expect(text).toContain('Closing checks');
    expect(text).toContain('Ready to close');
    expect(text).toContain('Result');
    expect(text).not.toContain('Close preparation');
    expect(text).not.toContain('Preparation coming');
    expect(text).not.toContain('ACCOUNTING.CLOSING');
  });

  it('shows the closing-check loading state while checks are loading', async () => {
    loadCurrentYear(fixture);

    httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}`).flush({
      data: {
        year: currentYear,
        fiscalYearId: `FY#${currentYear}`,
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`,
        status: 'OPEN',
        accountingFramework: 'SYSCOHADA_REVISED',
        periodLocks: {}
      }
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading closing checks...');

    flushClosingChecks(httpMock, apiBaseUrl, currentYear);
    await settle(fixture);
  });

  it('renders blocking errors, warnings, summary metrics, and hides technical response fields', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(
      httpMock,
      apiBaseUrl,
      currentYear,
      {},
      'OPEN',
      {
        ...cleanClosingChecks(currentYear),
        canClose: false,
        errors: [
          {
            code: 'DRAFT_ENTRIES_REMAIN',
            scope: 'ENTRY',
            message: 'Two draft entries remain.',
            entryId: 'ENTRY-1',
            PK: 'ORG#hidden'
          }
        ],
        warnings: [
          {
            code: 'UNLETTERED_AUXILIARY_LINES_REMAIN',
            scope: 'AUXILIARY',
            message: 'Supplier lines remain unlettered.',
            accountId: '40100000',
            entityType: 'TECHNICAL'
          }
        ],
        summary: {
          ...cleanClosingChecks(currentYear).summary,
          draftEntriesCount: 2,
          postedEntriesCount: 8,
          unbalancedEntriesCount: 1,
          trialBalanceDebit: 320000,
          trialBalanceCredit: 319000,
          unletteredAuxiliaryLinesCount: 3
        }
      }
    );
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Corrections required');
    expect(text).toContain('Two draft entries remain.');
    expect(text).toContain('Supplier lines remain unlettered.');
    expect(text).toContain('Drafts');
    expect(text).toContain('Posted entries');
    expect(text).toContain('320,000');
    expect(text).toContain('319,000');
    expect(text).toContain('Unlettered lines');
    expect(text).not.toContain('PK');
    expect(text).not.toContain('SK');
    expect(text).not.toContain('GSI');
    expect(text).not.toContain('entityType');
    expect(text).not.toContain('Zod');
  });

  it('locks open periods through confirmation and leaves closed periods read-only', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '01': 'LOCKED' });
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Closed');

    const component = fixture.componentInstance as unknown as {
      togglePeriod: (month: string) => void;
    };
    component.togglePeriod('01');
    fixture.detectChanges();

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/periods/1/close`);

    component.togglePeriod('02');
    fixture.detectChanges();

    expect(document.body.textContent).toContain('Lock this period?');
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/periods/2/close`);

    const lockDialog = TestBed.inject(MatDialog).openDialogs[0].componentInstance as unknown as {
      confirm: () => void;
    };
    lockDialog.confirm();
    await waitForDialogClose();
    const lockRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}/periods/2/close`);

    expect(lockRequest.request.body).toEqual({
      year: currentYear,
      month: 2
    });
    lockRequest.flush({
      message: 'Backend says period locked.',
      data: {
        year: currentYear,
        month: '02',
        status: 'LOCKED'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}`).flush({
      data: {
        year: currentYear,
        fiscalYearId: `FY#${currentYear}`,
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`,
        status: 'OPEN',
        accountingFramework: 'SYSCOHADA_REVISED',
        periodLocks: {
          '01': 'LOCKED',
          '02': 'LOCKED'
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushClosingChecks(httpMock, apiBaseUrl, currentYear);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('2');
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Backend says period locked.',
      undefined,
      expect.objectContaining({ panelClass: 'success-notification-overlay' })
    );
  });

  it('keeps fiscal-year close disabled with blocking errors', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(
      httpMock,
      apiBaseUrl,
      currentYear,
      {},
      'OPEN',
      {
        ...cleanClosingChecks(currentYear),
        canClose: false,
        errors: [
          {
            code: 'TRIAL_BALANCE_NOT_BALANCED',
            scope: 'TRIAL_BALANCE',
            message: 'Trial balance is not balanced.'
          }
        ]
      }
    );
    await settle(fixture);

    const closeButton = findButton(fixture, 'Close fiscal year');

    expect(closeButton?.disabled).toBe(true);
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/close`);
  });

  it('requires warning acknowledgment before closing and renders a success state', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(
      httpMock,
      apiBaseUrl,
      currentYear,
      {},
      'OPEN',
      {
        ...cleanClosingChecks(currentYear),
        warnings: [
          {
            code: 'UNLETTERED_AUXILIARY_LINES_REMAIN',
            scope: 'AUXILIARY',
            message: 'Customer lines remain unlettered.'
          }
        ],
        summary: {
          ...cleanClosingChecks(currentYear).summary,
          unletteredAuxiliaryLinesCount: 5
        }
      }
    );
    await settle(fixture);

    const closeButton = findButton(fixture, 'Close fiscal year');

    expect(closeButton?.disabled).toBe(false);
    closeButton?.click();
    fixture.detectChanges();

    expect(document.body.textContent).toContain('Confirm fiscal-year close');
    expect(document.body.textContent).toContain('Warnings must be acknowledged.');

    const overlay = document.body.querySelector('.cdk-overlay-container') as HTMLElement;
    const dialogButtonBeforeAcknowledge = Array.from<HTMLButtonElement>(overlay.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Close fiscal year')
    );
    expect(dialogButtonBeforeAcknowledge?.disabled).toBe(true);

    const checkbox = overlay.querySelector('mat-checkbox input') as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    const dialogButton = Array.from<HTMLButtonElement>(overlay.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Close fiscal year')
    );
    expect(dialogButton?.disabled).toBe(false);
    dialogButton?.click();
    await waitForDialogClose();

    const closeRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}/close`);

    expect(closeRequest.request.method).toBe('POST');
    expect(closeRequest.request.body).toEqual({
      year: String(currentYear),
      confirmWarnings: true
    });
    closeRequest.flush({
      message: 'Backend says fiscal year closed.',
      data: {
        fiscalYear: {
          year: currentYear,
          fiscalYearId: `FY#${currentYear}`,
          startDate: `${currentYear}-01-01`,
          endDate: `${currentYear}-12-31`,
          status: 'CLOSED',
          accountingFramework: 'SYSCOHADA_REVISED'
        },
        checks: {
          ...cleanClosingChecks(currentYear, 'CLOSED'),
          canClose: true
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}`).flush({
      data: {
        year: currentYear,
        fiscalYearId: `FY#${currentYear}`,
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`,
        status: 'CLOSED',
        accountingFramework: 'SYSCOHADA_REVISED',
        periodLocks: {}
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushClosingChecks(httpMock, apiBaseUrl, currentYear, cleanClosingChecks(currentYear, 'CLOSED'));
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain(`Fiscal year ${currentYear} is closed.`);
    expect(fixture.nativeElement.textContent).toContain('This fiscal year is closed.');
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Backend says fiscal year closed.',
      undefined,
      expect.objectContaining({ panelClass: 'success-notification-overlay' })
    );
  });
});

async function settle(fixture: ComponentFixture<FiscalYearPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 50));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function loadCurrentYear(fixture: ComponentFixture<FiscalYearPage>): void {
  const component = fixture.componentInstance as unknown as {
    loadSelectedYear: () => void;
  };

  component.loadSelectedYear();
  fixture.detectChanges();
}

function findButton(fixture: ComponentFixture<FiscalYearPage>, label: string): HTMLButtonElement | undefined {
  return Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(label)
  );
}

async function waitForDialogClose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function flushFiscalYearDetails(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  year: number,
  periodLocks: Record<string, 'LOCKED' | 'OPEN'>,
  status: 'OPEN' | 'LOCKED' | 'CLOSED' | 'ARCHIVED' = 'OPEN',
  closingChecks: ClosingChecksFixture = cleanClosingChecks(year, status)
): void {
  httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${year}`).flush({
    data: {
      year,
      fiscalYearId: `FY#${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status,
      accountingFramework: 'SYSCOHADA_REVISED',
      periodLocks
    }
  });
  flushClosingChecks(httpMock, apiBaseUrl, year, closingChecks);
}

interface ClosingChecksFixture {
  canClose: boolean;
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  summary: {
    fiscalYear: {
      year: number;
      fiscalYearId: string;
      startDate: string;
      endDate: string;
      status: 'OPEN' | 'LOCKED' | 'CLOSED' | 'ARCHIVED';
      accountingFramework: 'SYSCOHADA_REVISED' | 'SYCEBNL';
      PK?: string;
      SK?: string;
      entityType?: string;
    };
    draftEntriesCount: number;
    postedEntriesCount: number;
    unbalancedEntriesCount: number;
    trialBalanceDebit: number;
    trialBalanceCredit: number;
    unletteredAuxiliaryLinesCount?: number;
  };
}

function cleanClosingChecks(
  year: number,
  status: 'OPEN' | 'LOCKED' | 'CLOSED' | 'ARCHIVED' = 'OPEN'
): ClosingChecksFixture {
  return {
    canClose: status !== 'CLOSED',
    errors: [],
    warnings: [],
    summary: {
      fiscalYear: {
        year,
        fiscalYearId: `FY#${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        status,
        accountingFramework: 'SYSCOHADA_REVISED',
        PK: 'ORG#technical',
        SK: `FY#${year}`,
        entityType: 'FISCAL_YEAR'
      },
      draftEntriesCount: 0,
      postedEntriesCount: 4,
      unbalancedEntriesCount: 0,
      trialBalanceDebit: 250000,
      trialBalanceCredit: 250000,
      unletteredAuxiliaryLinesCount: 0
    }
  };
}

function flushClosingChecks(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  year: number,
  checks = cleanClosingChecks(year)
): void {
  httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${year}/closing-checks`).flush({
    data: checks
  });
}
