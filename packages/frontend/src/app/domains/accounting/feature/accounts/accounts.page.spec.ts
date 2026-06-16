import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { environment } from '../../../../../environments/environment';
import { AccountsPage } from './accounts.page';

const translations = {
  en: {
    ACCOUNTING: {
      ACCOUNTS: {
        ACTIONS: {
          CLEAR_FILTERS: 'Reset',
          EDIT_ACCOUNT: 'Edit',
          DISABLE_TODO: 'Disable later',
          EDIT_TODO: 'Edit later',
          LOAD_MORE: 'Load more',
          NEW_ACCOUNT: 'New account',
          NEW_ACCOUNT_TODO: 'Create later',
          RETRY: 'Retry'
        },
        CLASSES: {
          '1': 'Class 1 - Long-term resources',
          '2': 'Class 2 - Fixed assets',
          '3': 'Class 3 - Inventory',
          '4': 'Class 4 - Third parties',
          '5': 'Class 5 - Treasury',
          '6': 'Class 6 - Expenses',
          '7': 'Class 7 - Revenue',
          '8': 'Class 8 - Commitments'
        },
        DIALOG: {
          CREATE_EYEBROW: 'SYSCOHADA chart',
          CREATE_SUBTITLE: 'Add account.',
          CREATE_TITLE: 'Create account',
          EDIT_EYEBROW: 'SYSCOHADA account',
          EDIT_SUBTITLE: 'Update account.',
          EDIT_TITLE: 'Edit account'
        },
        EMPTY: {
          DESCRIPTION: 'No account is available.',
          NO_RESULTS_DESCRIPTION: 'Adjust filters.',
          NO_RESULTS_TITLE: 'No account matches the filters.',
          TITLE: 'No account loaded'
        },
        ERRORS: {
          LOAD_MORE_FAILED: 'The next page could not be loaded.'
        },
        EYEBROW: 'Chart of accounts',
        FILTERS: {
          ALL_CLASSES: 'All classes',
          ALL_NATURES: 'All natures',
          ALL_THIRD_PARTY: 'All accounts',
          CLASS: 'Class',
          NATURE: 'Nature',
          NON_THIRD_PARTY: 'General accounts',
          SEARCH: 'Search',
          THIRD_PARTY: 'Third party',
          THIRD_PARTY_ONLY: 'Third-party accounts'
        },
        FIELDS: {
          ACCOUNT_ID: 'Account number',
          ACCOUNT_NAME: 'Account label',
          CLASS: 'Class',
          NATURE: 'Nature',
          RECONCILIATION: 'Allow reconciliation',
          STATEMENT_CODE: 'Financial statement code',
          THIRD_PARTY: 'Third-party account',
          USAGE: 'Allowed direction'
        },
        FLAGS: {
          RECONCILIATION: 'Reconcilable',
          STANDARD: 'Standard',
          THIRD_PARTY: 'Third party'
        },
        METRICS: {
          THIRD_PARTY: 'Third-party accounts',
          TOTAL: 'Loaded accounts',
          VISIBLE: 'Visible'
        },
        NATURE: {
          BALANCE: 'Balance sheet',
          INCOME: 'Income'
        },
        SUBTITLE: 'Review accounts.',
        TABLE: {
          ACTIONS: 'Actions',
          CLASS: 'Class',
          CODE: 'Account',
          DESCRIPTION: 'Browsable chart.',
          FLAGS: 'Controls',
          NAME: 'Label',
          NATURE: 'Nature',
          TITLE: 'Accounts',
          USAGE: 'Direction'
        },
        TITLE: 'Chart of accounts',
        USAGE: {
          BOTH: 'Debit and credit',
          CREDIT_ONLY: 'Credit only',
          DEBIT_ONLY: 'Debit only'
        },
        VALIDATION: {
          ACCOUNT_ID: 'Enter 1 to 8 digits.',
          ACCOUNT_NAME: 'Enter an account label.',
          CLASS: 'Select a class.',
          STATEMENT_CODE: 'Enter a statement code.'
        }
      },
      ERRORS: {
        CREATE_ACCOUNT_FAILED: 'The account could not be created.',
        LOAD_FAILED: 'Accounting data could not be loaded.',
        UPDATE_ACCOUNT_FAILED: 'The account could not be updated.'
      }
    }
  },
  COMMON: {
    ACTIONS: {
      CANCEL: 'Cancel',
      SAVE: 'Save'
    }
  }
};

describe('AccountsPage', () => {
  let fixture: ComponentFixture<AccountsPage>;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [
        AccountsPage,
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
        provideTanStackQuery(
          new QueryClient({
            defaultOptions: {
              queries: {
                retry: false
              }
            }
          })
        )
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountsPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    httpMock.verify();
  });

  it('loads and renders the chart of accounts with CRUD actions', async () => {
    flushAccounts(httpMock, apiBaseUrl, [
      accountFixture({ accountId: '41100000', accountName: 'Clients', classCode: 4 }),
      accountFixture({
        accountId: '70100000',
        accountName: 'Ventes de marchandises',
        accountNature: 'INCOME',
        classCode: 7,
        isThirdPartyAccount: false
      })
    ]);
    await settle(fixture);

    const text = fixture.nativeElement.textContent;
    const disabledActions = fixture.nativeElement.querySelectorAll('button:disabled');

    expect(text).toContain('Chart of accounts');
    expect(text).toContain('Clients');
    expect(text).toContain('Ventes de marchandises');
    expect(text).toContain('Class 4 - Third parties');
    expect(text).toContain('Class 7 - Revenue');
    expect(disabledActions.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('New account');
  });

  it('filters accounts by search and class without calling the backend again', async () => {
    flushAccounts(httpMock, apiBaseUrl, [
      accountFixture({ accountId: '41100000', accountName: 'Clients', classCode: 4 }),
      accountFixture({
        accountId: '52100000',
        accountName: 'Banques locales',
        classCode: 5,
        isThirdPartyAccount: false
      })
    ]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      classFilter: { set: (value: number | 'ALL') => void };
      searchQuery: { set: (value: string) => void };
    };
    component.classFilter.set(5);
    component.searchQuery.set('banque');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Banques locales');
    expect(text).not.toContain('Clients');
    httpMock.expectNone((request) => request.url === `${apiBaseUrl}/accounts`);
  });

  it('renders empty and no-results states', async () => {
    flushAccounts(httpMock, apiBaseUrl, []);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('No account loaded');
  });

  it('renders a no-results state when filters hide all loaded accounts', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      searchQuery: { set: (value: string) => void };
    };
    component.searchQuery.set('missing');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No account matches the filters.');
  });

  it('renders an error state when accounts cannot be loaded', async () => {
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);
    request.flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Accounting data could not be loaded.');
  });

  it('loads the next page when the backend returns a cursor', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()], {
      hasMore: true,
      nextCursor: 'NEXT'
    });
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      loadMoreAccounts: () => Promise<void>;
    };
    const loadMore = component.loadMoreAccounts();
    const request = httpMock.expectOne(
      (candidate) =>
        candidate.url === `${apiBaseUrl}/accounts` &&
        candidate.params.get('cursor') === 'NEXT' &&
        candidate.params.get('limit') === '200'
    );

    request.flush({
      data: {
        accounts: [
          accountFixture({
            accountId: '70100000',
            accountName: 'Ventes de marchandises',
            accountNature: 'INCOME',
            classCode: 7,
            isThirdPartyAccount: false
          })
        ],
        hasMore: false
      }
    });
    await loadMore;
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Clients');
    expect(fixture.nativeElement.textContent).toContain('Ventes de marchandises');
  });

  it('creates an account from the dialog and refreshes the list without navigation', async () => {
    flushAccounts(httpMock, apiBaseUrl, []);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openCreateAccount: () => void;
    };
    component.openCreateAccount();
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        setValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };
    dialogInstance.form.setValue({
      accountId: '411',
      accountName: 'Clients auxiliaires',
      accountNature: 'BALANCE',
      accountUsage: 'BOTH',
      isThirdPartyAccount: true,
      classCode: 4,
      financialStatementCode: 'SYSCOHADA_CLASS_4',
      allowReconciliation: true
    });

    const submitPromise = dialogInstance.submit();
    const createRequest = httpMock.expectOne(`${apiBaseUrl}/accounts`);

    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({
      accountId: '411',
      accountName: 'Clients auxiliaires',
      accountNature: 'BALANCE',
      accountUsage: 'BOTH',
      isThirdPartyAccount: true,
      classCode: 4,
      financialStatementCode: 'SYSCOHADA_CLASS_4',
      allowReconciliation: true
    });
    createRequest.flush({
      account: accountFixture({
        accountId: '41100000',
        accountName: 'Clients auxiliaires',
        financialStatementCode: 'SYSCOHADA_CLASS_4'
      })
    });
    await submitPromise;
    await waitForDialogClose();
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Clients auxiliaires');
  });

  it('keeps the edit dialog open on failure and prevents duplicate submit', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openEditAccount: (account: ReturnType<typeof accountFixture>) => void;
    };
    component.openEditAccount(accountFixture());
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      form: {
        patchValue: (value: Record<string, unknown>) => void;
      };
      submit: () => Promise<void>;
    };
    dialogInstance.form.patchValue({ accountName: 'Clients corrigés' });

    const submitPromise = dialogInstance.submit();
    void dialogInstance.submit();
    const updateRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    expect(updateRequest.request.method).toBe('PUT');
    expect(updateRequest.request.body).toMatchObject({
      accountName: 'Clients corrigés'
    });
    httpMock.expectNone((request) => request.method === 'PUT' && request !== updateRequest.request);
    updateRequest.flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await submitPromise;
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    expect(document.body.textContent).toContain('The account could not be updated.');
  });
});

function flushAccounts(
  httpMock: HttpTestingController,
  apiBaseUrl: string,
  accounts: ReturnType<typeof accountFixture>[],
  options: { hasMore?: boolean; nextCursor?: string } = {}
): void {
  const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);

  expect(request.request.method).toBe('GET');
  request.flush({
    data: {
      accounts,
      hasMore: options.hasMore ?? false,
      nextCursor: options.nextCursor
    }
  });
}

function accountFixture(
  overrides: Partial<{
    accountId: string;
    accountName: string;
    accountNature: 'BALANCE' | 'INCOME';
    accountUsage: 'DEBIT_ONLY' | 'CREDIT_ONLY' | 'BOTH';
    classCode: number;
    financialStatementCode: string;
    isThirdPartyAccount: boolean;
    allowReconciliation: boolean;
  }> = {}
) {
  return {
    accountId: '41100000',
    accountName: 'Clients',
    accountNature: 'BALANCE',
    accountUsage: 'BOTH',
    classCode: 4,
    financialStatementCode: 'BS',
    isThirdPartyAccount: true,
    allowReconciliation: true,
    ...overrides
  };
}

async function settle(fixture: ComponentFixture<AccountsPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function waitForDialogClose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
