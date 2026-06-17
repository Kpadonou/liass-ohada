import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
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
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');
  const currentYear = new Date().getFullYear();

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

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
    expect(text.match(/Month/g)?.length).toBe(12);
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
    expect(text).not.toContain('Month');
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
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(TestBed.inject(AccountingFiscalYearContextService).activeYear()).toBeNull();
    expect(text).toContain('No fiscal year found for this year.');
    expect(text).not.toContain('Month');
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
  });

  it('locks and unlocks periods through confirmation dialogs', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '01': 'LOCKED' });
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      togglePeriod: (month: string) => void;
    };
    component.togglePeriod('02');
    fixture.detectChanges();

    expect(document.body.textContent).toContain('Lock this period?');
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/lock`);

    const lockDialog = TestBed.inject(MatDialog).openDialogs[0].componentInstance as unknown as {
      confirm: () => void;
    };
    lockDialog.confirm();
    await waitForDialogClose();
    const lockRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}/lock`);

    expect(lockRequest.request.body).toEqual({
      year: currentYear,
      month: 2,
      status: 'LOCKED'
    });
    lockRequest.flush({
      data: {
        year: currentYear,
        month: '02',
        status: 'LOCKED'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {
      '01': 'LOCKED',
      '02': 'LOCKED'
    });
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('2');

    component.togglePeriod('01');
    fixture.detectChanges();

    expect(document.body.textContent).toContain('Unlock this period?');
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/unlock`);

    const unlockDialog = TestBed.inject(MatDialog).openDialogs[0].componentInstance as unknown as {
      confirm: () => void;
    };
    unlockDialog.confirm();
    await waitForDialogClose();
    const unlockRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}/unlock`);

    expect(unlockRequest.request.body).toEqual({
      year: currentYear,
      month: 1
    });
    unlockRequest.flush({
      data: {
        year: currentYear,
        month: '01',
        status: 'OPEN'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '02': 'LOCKED' });
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('1');
  });

  it('keeps final closing disabled as a preparation-only workflow', async () => {
    loadCurrentYear(fixture);
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {});
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    const disabledButtons = Array.from(
      fixture.nativeElement.querySelectorAll('button[disabled]')
    ) as HTMLButtonElement[];

    expect(text).toContain('Close preparation');
    expect(text).toContain('Preparation coming');
    expect(disabledButtons.some((button) => button.textContent?.includes('Preparation coming'))).toBe(true);
    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/close`);
    expect(text).not.toContain('ACCOUNTING.FISCAL_YEAR');
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

async function waitForDialogClose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function flushFiscalYearDetails(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  year: number,
  periodLocks: Record<string, 'LOCKED' | 'OPEN'>,
  status: 'OPEN' | 'LOCKED' | 'CLOSED' | 'ARCHIVED' = 'OPEN'
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
}
