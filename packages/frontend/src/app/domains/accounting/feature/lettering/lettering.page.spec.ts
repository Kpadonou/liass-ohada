import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { environment } from '../../../../../environments/environment';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { CabinetDossiersApi } from '../../../identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../../identity/data-access/workspaces.api';
import { LetteringPage } from './lettering.page';

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
      ERRORS: {
        LOAD_FAILED: 'Accounting data could not be loaded.'
      },
      LETTERING: {
        ACTIONS: {
          CANCEL: 'Cancel lettering',
          CANCEL_GROUP: 'Unletter',
          LOAD: 'Load',
          POST: 'Letter',
          SELECT: 'Select'
        },
        EMPTY_SCOPE: 'Select an account and third party to load lettering.',
        ERRORS: {
          CANCEL_FAILED: 'Lettering could not be cancelled.',
          CANCEL_SELECTION_REQUIRED: 'Select at least one lettered line to cancel.',
          MISSING_YEAR: 'Missing year.',
          POST_FAILED: 'Lettering could not be saved.',
          SELECTION_REQUIRED: 'Select at least two unlettered lines.'
        },
        EYEBROW: 'Auxiliary accounts',
        FIELDS: {
          ACCOUNT: 'Third-party account',
          LETTERING_CODE: 'Lettering code',
          PROJECT: 'Project',
          THIRD_PARTY: 'Third party'
        },
        FILTERS: {
          DESCRIPTION: 'Choose a scope.',
          TITLE: 'Auxiliary scope'
        },
        LINE_TYPES: {
          CREDIT: 'Credit',
          DEBIT: 'Debit'
        },
        MESSAGES: {
          CANCELLED: 'Lettering cancelled.',
          POSTED: 'Lettering saved.'
        },
        REPORT: {
          DESCRIPTION: 'Already lettered groups.',
          EMPTY: 'No lettered group.',
          GROUP_LINES: '{{count}} line(s)',
          TITLE: 'Lettering report'
        },
        RESULT: {
          LINES: '{{count}} processed line(s)',
          TITLE: 'Result'
        },
        STATUS: {
          UNLETTERED: 'Unlettered'
        },
        SUBTITLE: 'Match third-party entries.',
        SUGGESTIONS: {
          AMOUNT: 'Amount',
          TYPES: {
            FIFO_SUGGESTION: 'FIFO suggestion',
            PERFECT_MATCH: 'Perfect match'
          }
        },
        SUMMARY: {
          BALANCE: 'Balance',
          CREDIT: 'Credit',
          DEBIT: 'Debit',
          DESCRIPTION: 'Third-party ledger summary.',
          LINES: '{{count}} line(s)',
          TITLE: 'Auxiliary ledger'
        },
        TABLE: {
          AMOUNT: 'Amount',
          DATE: 'Date',
          ENTRY: 'Entry',
          LABEL: 'Label',
          SELECT: 'Select',
          SELECT_LINE: 'Select line',
          STATUS: 'Lettering',
          TYPE: 'Direction'
        },
        TITLE: 'Lettering',
        UNLETTERED: {
          DESCRIPTION: 'Select lines.',
          EMPTY: 'No unlettered line.',
          SELECTED: 'Selected',
          SUGGESTIONS: 'Suggestions',
          TITLE: 'Unlettered lines',
          TOTAL: 'Unlettered'
        }
      }
    },
    COMMON: {
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      }
    }
  }
};

describe('LetteringPage', () => {
  let fixture: ComponentFixture<LetteringPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        LetteringPage,
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

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company-1',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      },
      'org-company-1'
    );
    TestBed.inject(AccountingFiscalYearContextService).selectFiscalYear({
      accountingFramework: 'SYSCOHADA_REVISED',
      endDate: '2026-12-31',
      fiscalYearId: 'FY#2026',
      startDate: '2026-01-01',
      status: 'OPEN',
      year: 2026
    });
    fixture = TestBed.createComponent(LetteringPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads accounts and renders the lettering filters', async () => {
    flushAccounts(httpMock, apiBaseUrl);
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Lettering');
    expect(text).toContain('Third-party account');
    expect(text).toContain('Third party');
    expect(text).toContain('Project');
  });

  it('calls auxiliary ledger, matching report, and unlettered routes with the selected scope', async () => {
    flushAccounts(httpMock, apiBaseUrl);
    await settle(fixture);
    setScope(fixture, { projectId: 'PRJ-1' });

    await flushScopeReads(httpMock, apiBaseUrl, { projectId: 'PRJ-1' });
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Auxiliary ledger');
    expect(text).toContain('Unlettered lines');
    expect(text).toContain('Perfect match');
    expect(text).toContain('LET001');
    expect(text).toContain('Customer invoice');
  });

  it('prevents posting when fewer than two lines are selected', async () => {
    flushAccounts(httpMock, apiBaseUrl);
    await settle(fixture);
    setScope(fixture);
    await flushScopeReads(httpMock, apiBaseUrl);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      postLettering: () => Promise<void>;
    };
    await component.postLettering();
    fixture.detectChanges();

    httpMock.expectNone(`${apiBaseUrl}/lettering`);
    expect(fixture.nativeElement.textContent).toContain('Select at least two unlettered lines.');
  });

  it('posts lettering with business line references and refreshes the scope', async () => {
    flushAccounts(httpMock, apiBaseUrl);
    await settle(fixture);
    setScope(fixture);
    await flushScopeReads(httpMock, apiBaseUrl);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      postLettering: () => Promise<void>;
      selectSuggestion: (suggestion: unknown) => void;
      suggestions: () => unknown[];
    };
    component.selectSuggestion(component.suggestions()[0]);
    fixture.detectChanges();

    const action = component.postLettering();
    const postRequest = httpMock.expectOne(`${apiBaseUrl}/lettering`);

    expect(postRequest.request.method).toBe('POST');
    expect(postRequest.request.body).toEqual({
      accountId: '41100000',
      thirdPartyId: 'TP-001',
      letteringCode: 'LET001',
      lines: [
        { year: 2026, entryId: 'E-001', lineId: 'L-001' },
        { year: 2026, entryId: 'E-002', lineId: 'L-002' }
      ]
    });
    postRequest.flush({
      letteringCode: 'LET001',
      letteringStatus: 'COMPLETE',
      linesProcessed: 2,
      remainingBalance: 0
    });
    await flushScopeReads(httpMock, apiBaseUrl);
    await action;
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Lettering saved.');
  });

  it('cancels lettering with selected line references and refreshes the scope', async () => {
    flushAccounts(httpMock, apiBaseUrl);
    await settle(fixture);
    setScope(fixture);
    await flushScopeReads(httpMock, apiBaseUrl);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      cancelSelectedLettering: () => Promise<void>;
      toggleLine: (line: unknown, checked: boolean) => void;
      unletteredLines: () => unknown[];
    };
    component.toggleLine(component.unletteredLines()[0], true);
    fixture.detectChanges();

    const action = component.cancelSelectedLettering();
    const cancelRequest = httpMock.expectOne(`${apiBaseUrl}/lettering/cancel`);

    expect(cancelRequest.request.method).toBe('POST');
    expect(cancelRequest.request.body).toEqual({
      accountId: '41100000',
      thirdPartyId: 'TP-001',
      lines: [{ year: 2026, entryId: 'E-001', lineId: 'L-001' }]
    });
    cancelRequest.flush({
      letteringCode: 'LET001',
      letteringStatus: 'PARTIAL',
      linesProcessed: 1,
      remainingBalance: 10000
    });
    await flushScopeReads(httpMock, apiBaseUrl);
    await action;
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Lettering cancelled.');
  });
});

async function settle(fixture: ComponentFixture<LetteringPage>): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

function setScope(
  fixture: ComponentFixture<LetteringPage>,
  options: { projectId?: string } = {}
): void {
  const component = fixture.componentInstance as unknown as {
    applyFilters: () => void;
    form: {
      controls: {
        accountId: { setValue: (value: string) => void };
        thirdPartyId: { setValue: (value: string) => void };
        projectId: { setValue: (value: string) => void };
      };
    };
  };

  component.form.controls.accountId.setValue('41100000');
  component.form.controls.thirdPartyId.setValue('TP-001');
  component.form.controls.projectId.setValue(options.projectId ?? '');
  component.applyFilters();
  fixture.detectChanges();
}

function flushAccounts(httpMock: HttpTestingController, apiBaseUrl: string): void {
  httpMock.expectNone((request) => request.url === `${apiBaseUrl}/accounts`);
}

async function flushScopeReads(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  options: { projectId?: string } = {}
): Promise<void> {
  const ledgerRequest = await expectOneEventually(httpMock, (request) => {
    return (
      request.url === `${apiBaseUrl}/books/third-party-ledger` &&
      request.params.get('accountId') === '41100000' &&
      request.params.get('thirdPartyId') === 'TP-001'
    );
  });
  expect(ledgerRequest.request.method).toBe('GET');
  ledgerRequest.flush({
    data: {
      accountId: '41100000',
      thirdPartyId: 'TP-001',
      period: {},
      summary: {
        totalDebit: 100000,
        totalCredit: 80000,
        balance: 20000
      },
      count: 2,
      lines: [
        {
          date: '2026-01-05',
          label: 'Customer invoice',
          reference: 'E-001',
          debit: 100000,
          credit: 0,
          letteringCode: null,
          entryId: 'E-001',
          lineId: 'L-001'
        }
      ]
    }
  });

  const matchingRequest = await expectOneEventually(httpMock, (request) => {
    return (
      request.url === `${apiBaseUrl}/books/matching-report` &&
      request.params.get('accountId') === '41100000' &&
      request.params.get('thirdPartyId') === 'TP-001'
    );
  });
  expect(matchingRequest.request.method).toBe('GET');
  matchingRequest.flush({
    data: {
      accountId: '41100000',
      thirdPartyId: 'TP-001',
      summary: {
        totalDebit: 100000,
        totalCredit: 80000,
        balance: 20000
      },
      letteredGroups: {
        LET001: [accountLine('E-003', 'L-003', 50000, 0, 'LET001')]
      },
      unletteredLines: [accountLine('E-001', 'L-001', 100000, 0)]
    }
  });

  const unletteredRequest = await expectOneEventually(httpMock, (request) => {
    return (
      request.url === `${apiBaseUrl}/lettering/unlettered` &&
      request.params.get('accountId') === '41100000' &&
      request.params.get('thirdPartyId') === 'TP-001' &&
      request.params.get('projectId') === (options.projectId ?? null)
    );
  });
  expect(unletteredRequest.request.method).toBe('GET');
  unletteredRequest.flush({
    totalUnlettered: 2,
    suggestionsFound: 1,
    unletteredLines: [
      accountLine('E-001', 'L-001', 100000, 0),
      accountLine('E-002', 'L-002', 0, 100000)
    ],
    suggestions: [
      {
        type: 'PERFECT_MATCH',
        amount: 100000,
        lines: [
          {
            year: 2026,
            entryId: 'E-001',
            lineId: 'L-001',
            date: '2026-01-05',
            label: 'Customer invoice',
            amount: 100000,
            type: 'DEBIT'
          },
          {
            year: 2026,
            entryId: 'E-002',
            lineId: 'L-002',
            date: '2026-01-12',
            label: 'Payment',
            amount: 100000,
            type: 'CREDIT'
          }
        ]
      }
    ]
  });
}

async function expectOneEventually(
  httpMock: HttpTestingController,
  predicate: Parameters<HttpTestingController['expectOne']>[0]
) {
  let lastError: unknown;

  for (let index = 0; index < 20; index += 1) {
    try {
      return httpMock.expectOne(predicate);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  throw lastError;
}

function accountLine(
  entryId: string,
  lineId: string,
  debit: number,
  credit: number,
  letteringCode?: string
) {
  return {
    year: 2026,
    entryId,
    lineId,
    accountId: '41100000',
    debit,
    credit,
    description: 'Line description',
    label: entryId === 'E-001' ? 'Customer invoice' : 'Payment',
    entryDate: entryId === 'E-001' ? '2026-01-05' : '2026-01-12',
    voucherNumber: entryId,
    journalCode: 'VE',
    thirdPartyId: 'TP-001',
    letteringCode,
    letteringStatus: letteringCode ? 'COMPLETE' : undefined,
    createdAt: '2026-01-05T00:00:00.000Z'
  };
}
