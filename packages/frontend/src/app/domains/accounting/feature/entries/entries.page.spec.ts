import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { EntriesPage } from './entries.page';

describe('EntriesPage', () => {
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        EntriesPage,
        TranslocoTestingModule.forRoot({
          langs: { en: {} },
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
        provideTanStackQuery(new QueryClient()),
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
    httpMock.verify();
  });

  it('tracks unbalanced and balanced entry lines', async () => {
    selectFiscalYear();
    const fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();
    flushInitialQueries(httpMock, apiBaseUrl);
    await fixture.whenStable();

    const component = fixture.componentInstance as any;
    const lines = component.lines;
    lines.at(0).patchValue({ accountId: '41100000', debit: 1000, credit: 0 });
    lines.at(1).patchValue({ accountId: '70100000', debit: 0, credit: 700 });
    fixture.detectChanges();

    expect(component.totalDebit()).toBe(1000);
    expect(component.totalCredit()).toBe(700);
    expect(component.isBalanced()).toBe(false);

    lines.at(1).patchValue({ credit: 1000 });
    fixture.detectChanges();

    expect(component.totalDebit()).toBe(1000);
    expect(component.totalCredit()).toBe(1000);
    expect(component.isBalanced()).toBe(true);
  });

  it('shows a fiscal-year required state without loading entries when no fiscal year is active', async () => {
    const fixture = TestBed.createComponent(EntriesPage);
    fixture.detectChanges();
    flushReferenceQueries(httpMock, apiBaseUrl);
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/entries`);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('ACCOUNTING.FISCAL_YEAR_CONTEXT.EMPTY_TITLE');
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

function flushInitialQueries(httpMock: HttpTestingController, apiBaseUrl: string): void {
  flushReferenceQueries(httpMock, apiBaseUrl);

  httpMock.expectOne((request) => request.url === `${apiBaseUrl}/entries`).flush({
    data: {
      entries: [],
      hasMore: false
    }
  });
}

function flushReferenceQueries(httpMock: HttpTestingController, apiBaseUrl: string): void {
  httpMock.expectOne((request) => request.url === `${apiBaseUrl}/accounts`).flush({
    data: {
      accounts: [
        {
          accountId: '41100000',
          accountName: 'Clients',
          accountNature: 'BALANCE',
          accountUsage: 'BOTH',
          isThirdPartyAccount: true,
          classCode: 4,
          financialStatementCode: 'BS',
          allowReconciliation: true
        },
        {
          accountId: '70100000',
          accountName: 'Ventes',
          accountNature: 'INCOME',
          accountUsage: 'CREDIT_ONLY',
          isThirdPartyAccount: false,
          classCode: 7,
          financialStatementCode: 'IS',
          allowReconciliation: false
        }
      ],
      hasMore: false
    }
  });

  httpMock.expectOne((request) => request.url === `${apiBaseUrl}/journals`).flush({
    data: []
  });
}
