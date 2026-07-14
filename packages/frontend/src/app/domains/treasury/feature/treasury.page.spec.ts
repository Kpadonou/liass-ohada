import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { AuthStore } from '../../identity/data-access/auth.store';
import { TreasuryPage } from './treasury.page';

const translations = {
  en: {
    COMMON: {
      ACTIONS: { CANCEL: 'Cancel' },
      EMPTY_VALUE: '—',
      NOTIFICATIONS: { LOAD_ERROR: 'Loading failed.' }
    },
    TREASURY: {
      ACCOUNTS: {
        CLASS5_HINT: 'Linked class 5 account',
        CREATE: { SUBMIT: 'Create account', TITLE: 'Create treasury account' },
        EMPTY: 'No treasury account has been configured.',
        EMPTY_GUIDANCE: 'Create a treasury account first.',
        EMPTY_TITLE: 'No treasury account yet',
        FIELDS: {
          ACCOUNT_ID: 'SYSCOHADA class 5 account',
          BANK_ACCOUNT_NUMBER: 'Bank account number',
          BANK_NAME: 'Bank',
          CURRENCY: 'Currency',
          LABEL: 'Label',
          OPENING_BALANCE: 'Opening balance',
          TYPE: 'Type'
        },
        LOAD_MORE: 'Load more accounts',
        SELECT_EMPTY: 'No treasury account available',
        STATUS: { ACTIVE: 'Active', INACTIVE: 'Inactive' },
        TABLE: {
          BANK: 'Bank',
          LABEL: 'Treasury account',
          LINKED_ACCOUNT: 'Linked account',
          STATUS: 'Status',
          TYPE: 'Type',
          UPDATED_AT: 'Updated'
        },
        TYPES: { BANK: 'Bank', CASH: 'Cash', MOBILE_MONEY: 'Mobile money' }
      },
      ACTIONS: { NEW_ACCOUNT: 'New account', NEW_TRANSACTION: 'New transaction' },
      ERRORS: {
        CANCEL_RECONCILE_FAILED: 'Cancel failed.',
        CREATE_ACCOUNT_FAILED: 'Create failed.',
        IMPORT_FAILED: 'Import failed.',
        LOAD_FAILED: 'Treasury data could not be loaded.',
        LOAD_MORE_ACCOUNTS_FAILED: 'More accounts could not be loaded.',
        POST_TRANSACTION_FAILED: 'Post failed.',
        RECONCILE_FAILED: 'Reconcile failed.'
      },
      FILTERS: { ACCOUNT: 'Treasury account', YEAR: 'Fiscal year' },
      IMPORT: {
        ACTION: 'Import statement',
        ERRORS: '{{count}} invalid rows',
        PLACEHOLDER: 'Paste structured statement rows here.',
        RESULT: '{{imported}} imported, {{skipped}} duplicates',
        TEXTAREA: 'Statement CSV'
      },
      MOVEMENTS: {
        EMPTY: 'No movement.',
        TABLE: {
          BALANCE: 'Balance',
          DATE: 'Date',
          INFLOW: 'Inflows',
          LABEL: 'Label',
          OUTFLOW: 'Outflows',
          REFERENCE: 'Reference',
          STATUS: 'Reconciliation'
        }
      },
      PAGE: {
        EYEBROW: 'Treasury workspace',
        SUBTITLE: 'Track treasury.',
        TITLE: 'Treasury'
      },
      RECONCILIATION: {
        CANCEL: 'Cancel',
        MATCH: 'Reconcile',
        MOVEMENTS: 'Unmatched movements',
        NO_MOVEMENTS: 'No movements.',
        NO_STATEMENT_LINES: 'No statement lines.',
        STATEMENT_LINES: 'Unmatched statement lines',
        STATUS: { MATCHED: 'Matched', UNMATCHED: 'Unmatched' }
      },
      STATEMENT: {
        EMPTY: 'No statement line.',
        STATUS: { IGNORED: 'Ignored', MATCHED: 'Matched', UNMATCHED: 'Unmatched' },
        TABLE: {
          ACTIONS: 'Actions',
          AMOUNT: 'Amount',
          DATE: 'Date',
          LABEL: 'Label',
          STATUS: 'Status'
        }
      },
      STATS: {
        ACCOUNTS: { LABEL: 'Accounts', META: 'Bank, cash, and mobile money' },
        INFLOWS: { LABEL: 'Inflows', META: 'Class 5 debit flows' },
        OUTFLOWS: { LABEL: 'Outflows', META: 'Class 5 credit flows' },
        UNRECONCILED: { LABEL: 'To reconcile', META: 'Open statement lines' }
      },
      TABS: {
        ACCOUNTS: 'Accounts',
        MOVEMENTS: 'Movements',
        RECONCILIATION: 'Reconciliation',
        STATEMENT: 'Statement'
      }
    }
  }
};

describe('TreasuryPage accounts tab', () => {
  let fixture: ComponentFixture<TreasuryPage>;
  let httpMock: HttpTestingController;
  let queryClient: QueryClient;
  let dialogOpen: ReturnType<typeof vi.fn>;
  const apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });
    dialogOpen = vi.fn();

    TestBed.configureTestingModule({
      imports: [
        TreasuryPage,
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
        provideTanStackQuery(queryClient),
        {
          provide: AuthStore,
          useValue: {
            activeDossierOrgId: () => null,
            activeWorkspaceOrgId: () => 'org-test',
            activeWorkspaceType: () => 'COMPANY'
          }
        },
      ]
    });
    TestBed.overrideProvider(MatDialog, {
      useValue: { open: dialogOpen }
    });
    await TestBed.compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TreasuryPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    queryClient.clear();
  });

  it('renders the page and the accounts tab empty state safely', async () => {
    flushAccounts([]);
    flushSummary({ accountsCount: 0 });
    await settle();

    const text = fixture.nativeElement.textContent;
    const selector = fixture.nativeElement.querySelector('mat-select');

    expect(text).toContain('Treasury');
    expect(text).toContain('Accounts');
    expect(text).toContain('No treasury account yet');
    expect(text).toContain('Create a treasury account first.');
    expect(selector.getAttribute('aria-disabled')).toBe('true');
    expect(text).not.toContain('2026-01-15,VIR-001,Encaissement client,150000,XOF');
  });

  it('displays treasury accounts returned by the API', async () => {
    flushAccounts([accountFixture()]);
    flushSummary({ accountsCount: 1 });
    await settle();
    flushMovementsAndStatementLines();
    await settle();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Main bank');
    expect(text).toContain('52100000');
    expect(text).toContain('Linked class 5 account');
    expect(text).toContain('Active');
  });

  it('opens create dialog and invalidates treasury accounts and summary after creation', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    dialogOpen.mockReturnValue({
      afterClosed: () => of(accountFixture({ treasuryAccountId: '53100000', accountId: '53100000', label: 'Cash desk' }))
    });
    flushAccounts([]);
    flushSummary({ accountsCount: 0 });
    await settle();

    const newAccountButton = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      button.textContent.includes('New account')
    ) as HTMLButtonElement;
    newAccountButton.click();
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['treasury', 'org-test', 'accounts']
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['treasury', 'org-test', 'summary']
    });
    flushAccounts([
      accountFixture({ treasuryAccountId: '53100000', accountId: '53100000', label: 'Cash desk' })
    ]);
    flushSummary({ accountsCount: 1 });
    await settle();
    flushSelectedAccountRequests('53100000');
  });

  function flushAccounts(accounts: ReturnType<typeof accountFixture>[]) {
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/treasury/accounts`);
    request.flush({
      data: {
        accounts,
        count: accounts.length,
        hasMore: false
      }
    });
  }

  function flushSummary(overrides: { accountsCount: number }) {
    const request = httpMock.expectOne((candidate) => candidate.url === `${apiBaseUrl}/treasury/summary`);
    request.flush({
      data: {
        year: '2026',
        accountsCount: overrides.accountsCount,
        totalInflows: 0,
        totalOutflows: 0,
        netCashFlow: 0,
        unreconciledStatementLines: 0,
        unreconciledMovements: 0
      }
    });
  }

  function flushMovementsAndStatementLines() {
    flushSelectedAccountRequests('52100000');
  }

  function flushSelectedAccountRequests(treasuryAccountId: string) {
    const movementRequests = httpMock.match(
      (candidate) => candidate.url === `${apiBaseUrl}/treasury/accounts/${treasuryAccountId}/movements`
    );
    const statementRequests = httpMock.match(
      (candidate) => candidate.url === `${apiBaseUrl}/treasury/accounts/${treasuryAccountId}/statement-lines`
    );

    expect(movementRequests.length).toBe(1);
    expect(statementRequests.length).toBe(1);
    movementRequests[0].flush({ data: { movements: [] } });
    statementRequests[0].flush({ data: { statementLines: [] } });
  }

  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
});

function accountFixture(overrides: Partial<ReturnType<typeof accountFixtureBase>> = {}) {
  return {
    ...accountFixtureBase(),
    ...overrides
  };
}

function accountFixtureBase() {
  return {
    orgId: 'org-test',
    treasuryAccountId: '52100000',
    accountId: '52100000',
    label: 'Main bank',
    type: 'BANK' as const,
    currency: 'XOF',
    openingBalance: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z'
  };
}
