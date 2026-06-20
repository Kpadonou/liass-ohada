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
import { AccountsPage } from './accounts.page';

const translations = {
  en: {
    ACCOUNTING: {
      ACCOUNTS: {
        ACTIONS: {
          CLEAR_FILTERS: 'Reset',
          DISABLE_ACCOUNT: 'Disable',
          EDIT_ACCOUNT: 'Edit',
          DISABLE_TODO: 'Disable later',
          EDIT_TODO: 'Edit later',
          LOAD_MORE: 'Load more',
          NEW_ACCOUNT: 'New account',
          NEW_ACCOUNT_TODO: 'Create later',
          RETRY: 'Retry',
          VIEW_DETAILS: 'View details'
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
        DETAIL: {
          CONTROLS: 'Controls',
          EYEBROW: 'Account detail'
        },
        DISABLE: {
          DESCRIPTION: 'Disabling {{ accountId }} - {{ accountName }} prevents future use.',
          EYEBROW: 'Disable',
          TITLE: 'Disable this account?'
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
          ALL_STATUSES: 'All statuses',
          ALL_THIRD_PARTY: 'All accounts',
          CLASS: 'Class',
          NATURE: 'Nature',
          NON_THIRD_PARTY: 'General accounts',
          SEARCH: 'Search by account number',
          SEARCH_PLACEHOLDER: 'E.g. 4, 411 or 521',
          STATUS: 'Status',
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
        LOADING: 'Loading chart of accounts...',
        METRICS: {
          THIRD_PARTY: 'Third-party accounts',
          TOTAL: 'Loaded accounts',
          VISIBLE: 'Visible'
        },
        PAGINATION: {
          DISPLAYED: 'Accounts displayed'
        },
        NATURE: {
          BALANCE: 'Balance sheet',
          INCOME: 'Income'
        },
        STATUS: {
          ACTIVE: 'Active',
          INACTIVE: 'Inactive'
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
          STATUS: 'Status',
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
        DISABLE_ACCOUNT_FAILED: 'The account could not be disabled.',
        LOAD_FAILED: 'Accounting data could not be loaded.',
        UPDATE_ACCOUNT_FAILED: 'The account could not be updated.'
      },
      NOTIFICATIONS: {
        ACCOUNT_CREATED: 'Account created successfully.',
        ACCOUNT_DISABLED: 'Account disabled successfully.',
        ACCOUNT_UPDATED: 'Account updated successfully.'
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

describe('AccountsPage', () => {
  let fixture: ComponentFixture<AccountsPage>;
  let httpMock: HttpTestingController;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    TestBed.resetTestingModule();
    snackBarOpen = vi.fn();

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
        { provide: MatSnackBar, useValue: { open: snackBarOpen } },
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
    localStorage.clear();
    fixture = TestBed.createComponent(AccountsPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    localStorage.clear();
    httpMock.verify();
  });

  it('shows translated loading feedback while accounts are loading', () => {
    const text = fixture.nativeElement.textContent;
    const loadingState = fixture.nativeElement.querySelector('[role="status"]');
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/accounts`);

    expect(request.request.params.get('limit')).toBe('100');
    expect(text).toContain('Loading chart of accounts...');
    expect(text).not.toContain('No account loaded');
    expect(loadingState?.getAttribute('aria-busy')).toBe('true');

    request.flush({
      data: {
        accounts: [],
        hasMore: false
      }
    });
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

    expect(text).toContain('Chart of accounts');
    expect(text).toContain('Clients');
    expect(text).toContain('Ventes de marchandises');
    expect(text).toContain('Class 4 - Third parties');
    expect(text).toContain('Class 7 - Revenue');
    expect(text).toContain('Active');
    expect(text).toContain('New account');
  });

  it('uses a compact row action menu with icons and translated labels', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const actionTrigger = fixture.nativeElement.querySelector('[data-testid="account-row-actions"]') as HTMLButtonElement;
    actionTrigger.click();
    await settle(fixture);

    const menu = document.body;

    expect(menu.textContent).toContain('View details');
    expect(menu.textContent).toContain('Edit');
    expect(menu.textContent).toContain('Disable');
    expect(menu.querySelector('[data-testid="account-view-action"] mat-icon')?.textContent?.trim()).toBe('visibility');
    expect(menu.querySelector('[data-testid="account-edit-action"] mat-icon')?.textContent?.trim()).toBe('edit');
    expect(menu.querySelector('[data-testid="account-disable-action"] mat-icon')?.textContent?.trim()).toBe('block');
    expect(menu.querySelector('[data-testid="account-view-action"]')?.classList).toContain('liass-menu-action-neutral');
    expect(menu.querySelector('[data-testid="account-edit-action"]')?.classList).toContain('liass-menu-action-info');
    expect(menu.querySelector('[data-testid="account-disable-action"]')?.classList).toContain('liass-menu-action-danger');
  });

  it('keeps destructive row actions behind the confirmation dialog', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    (fixture.nativeElement.querySelector('[data-testid="account-row-actions"]') as HTMLButtonElement).click();
    await settle(fixture);
    (document.body.querySelector('[data-testid="account-disable-action"]') as HTMLButtonElement).click();
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    expect(document.body.textContent).toContain('Disable this account?');
    httpMock.expectNone(`${apiBaseUrl}/accounts/41100000`);
  });

  it('opens table preferences and persists hidden optional columns', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openTablePreferences: () => void;
    };
    component.openTablePreferences();
    fixture.detectChanges();
    await settle(fixture);

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];

    expect(document.body.textContent).toContain('Preferences');
    expect(document.body.textContent).toContain('Visible columns');
    dialogRef.close({ visibleColumnIds: ['nature'] });
    await waitForDialogClose();
    await settle(fixture);

    const tableText = (fixture.nativeElement.querySelector('table') as HTMLTableElement).textContent ?? '';
    const storedPreferences = JSON.parse(localStorage.getItem('liass.table-preferences.accounting.accounts') ?? '{}') as {
      visibleColumnIds?: string[];
    };

    expect(tableText).toContain('Account');
    expect(tableText).toContain('Label');
    expect(tableText).toContain('Actions');
    expect(tableText).not.toContain('Class');
    expect(storedPreferences.visibleColumnIds).not.toContain('class');
    expect(storedPreferences.visibleColumnIds).toEqual(
      expect.arrayContaining(['code', 'name', 'actions'])
    );
  });

  it('searches account-code prefixes on the server and does not promise label search', async () => {
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
      searchQuery: { set: (value: string) => void };
      resetPagination: () => void;
    };
    component.searchQuery.set('521');
    component.resetPagination();
    fixture.detectChanges();

    const request = httpMock.expectOne(
      (candidate) =>
        candidate.url === `${apiBaseUrl}/accounts` &&
        candidate.params.get('search') === '521' &&
        candidate.params.get('limit') === '100'
    );
    request.flush({
      data: {
        accounts: [
          accountFixture({
            accountId: '52100000',
            accountName: 'Banques locales',
            classCode: 5,
            isThirdPartyAccount: false
          })
        ],
        hasMore: false
      }
    });
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Banques locales');
    expect(fixture.nativeElement.textContent).not.toContain('Clients');
    expect(fixture.nativeElement.textContent).toContain('Search by account number');
    expect(fixture.nativeElement.textContent).not.toContain('Search by label');
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
    component.searchQuery.set('999');
    fixture.detectChanges();
    httpMock.expectOne(
      (candidate) =>
        candidate.url === `${apiBaseUrl}/accounts` &&
        candidate.params.get('search') === '999'
    ).flush({
      data: {
        accounts: [],
        hasMore: false
      }
    });
    await settle(fixture);

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
        candidate.params.get('limit') === '100'
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

  it('preserves server-backed class and status filters when loading more', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()], {
      hasMore: false
    });
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      updateClassFilter: (value: number) => void;
      updateStatusFilter: (value: 'INACTIVE') => void;
      loadMoreAccounts: () => Promise<void>;
    };
    component.updateClassFilter(4);
    component.updateStatusFilter('INACTIVE');
    fixture.detectChanges();

    const filteredRequest = httpMock.expectOne(
      (candidate) =>
        candidate.url === `${apiBaseUrl}/accounts` &&
        candidate.params.get('class') === '4' &&
        candidate.params.get('active') === 'false'
    );
    filteredRequest.flush({
      data: {
        accounts: [accountFixture({ isActive: false })],
        hasMore: true,
        nextCursor: 'FILTERED-NEXT'
      }
    });
    await settle(fixture);

    const loadMorePromise = component.loadMoreAccounts();
    const nextRequest = httpMock.expectOne(
      (candidate) =>
        candidate.url === `${apiBaseUrl}/accounts` &&
        candidate.params.get('cursor') === 'FILTERED-NEXT' &&
        candidate.params.get('class') === '4' &&
        candidate.params.get('active') === 'false' &&
        candidate.params.get('limit') === '100'
    );
    nextRequest.flush({
      data: {
        accounts: [],
        hasMore: false
      }
    });
    await loadMorePromise;
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
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Account created successfully.',
      undefined,
      expect.objectContaining({ panelClass: 'success-notification-overlay' })
    );
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
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Nope',
      undefined,
      expect.objectContaining({ panelClass: 'error-notification-overlay' })
    );
  });

  it('opens account details in a drawer', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openAccountDetails: (account: ReturnType<typeof accountFixture>) => void;
    };
    component.openAccountDetails(accountFixture());
    fixture.detectChanges();
    await settle(fixture);

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Account detail');
    expect(text).toContain('41100000');
    expect(text).toContain('Clients');
    expect(text).toContain('Controls');
  });

  it('disables an account through confirmation and keeps existing rows visible', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openDisableAccount: (account: ReturnType<typeof accountFixture>) => void;
    };
    component.openDisableAccount(accountFixture());
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      confirm: () => Promise<void>;
    };
    const confirmPromise = dialogInstance.confirm();
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    expect(disableRequest.request.method).toBe('DELETE');
    disableRequest.flush({
      message: 'Backend says account disabled.',
      account: accountFixture({ isActive: false })
    });
    await confirmPromise;
    await waitForDialogClose();
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Clients');
    expect(fixture.nativeElement.textContent).toContain('Inactive');
    expect(snackBarOpen).toHaveBeenCalledWith(
      'Backend says account disabled.',
      undefined,
      expect.objectContaining({ panelClass: 'success-notification-overlay' })
    );
  });

  it('keeps the disable confirmation open on failure', async () => {
    flushAccounts(httpMock, apiBaseUrl, [accountFixture()]);
    await settle(fixture);

    const component = fixture.componentInstance as unknown as {
      openDisableAccount: (account: ReturnType<typeof accountFixture>) => void;
    };
    component.openDisableAccount(accountFixture());
    fixture.detectChanges();

    const dialogRef = TestBed.inject(MatDialog).openDialogs[0];
    const dialogInstance = dialogRef.componentInstance as unknown as {
      confirm: () => Promise<void>;
    };
    const confirmPromise = dialogInstance.confirm();
    const disableRequest = httpMock.expectOne(`${apiBaseUrl}/accounts/41100000`);

    disableRequest.flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });
    await confirmPromise;
    await settle(fixture);

    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(1);
    expect(document.body.textContent).toContain('The account could not be disabled.');
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
    isActive: boolean;
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
    isActive: true,
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
