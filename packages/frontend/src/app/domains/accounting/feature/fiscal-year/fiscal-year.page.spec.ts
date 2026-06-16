import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { environment } from '../../../../../environments/environment';
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
          CLOSE: 'Close fiscal year',
          CREATE: 'Create',
          LOAD: 'Load',
          LOCK: 'Lock',
          UNLOCK: 'Unlock'
        },
        CLOSE: {
          DESCRIPTION: 'Generate closing entry.',
          HELP: 'Close after review.',
          TITLE: 'Year-end close'
        },
        CLOSE_DIALOG: {
          CANCEL: 'Cancel',
          CONFIRM: 'Close year',
          DESCRIPTION: 'Create the closing entry.',
          TITLE: 'Confirm fiscal year close',
          WARNING: 'Review the trial balance.'
        },
        EMPTY: 'No fiscal year found.',
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
          TITLE: 'Period locks'
        },
        SELECTOR: {
          DESCRIPTION: 'Choose a fiscal year.',
          TITLE: 'Scope'
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
        TITLE: 'Fiscal year'
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
        provideTanStackQuery(new QueryClient()),
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
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '01': 'LOCKED' });
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Fiscal year');
    expect(text).toContain('January');
    expect(text).toContain('December');
    expect(text.match(/Month/g)?.length).toBe(12);
    expect(text).toContain('Locked');
    expect(text).toContain('Open');
  });

  it('locks and unlocks periods through backend routes', async () => {
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '01': 'LOCKED' });
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      togglePeriod: (month: string) => Promise<void>;
    };
    const lockAction = component.togglePeriod('02');
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
    await lockAction;
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {
      '01': 'LOCKED',
      '02': 'LOCKED'
    });
    await settle(fixture);

    const unlockAction = component.togglePeriod('01');
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
    await unlockAction;
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, { '02': 'LOCKED' });
    await settle(fixture);
  });

  it('requires confirmation before closing the fiscal year and refreshes after success', async () => {
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {});
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      confirmCloseYear: () => void;
      closeYear: () => Promise<void>;
    };
    component.confirmCloseYear();
    fixture.detectChanges();

    httpMock.expectNone(`${apiBaseUrl}/fiscal-year/${currentYear}/close`);
    expect(document.body.textContent).toContain('Confirm fiscal year close');

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    const closeAction = component.closeYear();

    const closeRequest = httpMock.expectOne(`${apiBaseUrl}/fiscal-year/${currentYear}/close`);

    expect(closeRequest.request.method).toBe('POST');
    closeRequest.flush({
      data: {
        entryId: 'E-CLOSE',
        netResult: 120000,
        isProfit: true
      }
    });
    await closeAction;
    flushFiscalYearDetails(httpMock, apiBaseUrl, currentYear, {}, 'CLOSED');
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('E-CLOSE');
  });
});

async function settle(fixture: ComponentFixture<FiscalYearPage>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
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
