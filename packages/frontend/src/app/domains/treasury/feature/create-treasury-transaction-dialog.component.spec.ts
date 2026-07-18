import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AccountingApi } from '../../accounting/data-access/accounting.api';
import { AccountSearchSelectComponent } from '../../accounting/ui/account-search-select/account-search-select.component';
import { TreasuryApi } from '../data-access/treasury.api';
import { CreateTreasuryTransactionDialogComponent } from './create-treasury-transaction-dialog.component';

const translations = {
  en: {
    ACCOUNTING: {
      ACCOUNTS: {
        SELECT: {
          LABEL: 'Account',
          LOAD_MORE: 'Load more accounts',
          LOADING: 'Searching accounts...',
          NO_RESULTS: 'No accounts found',
          SEARCH_PLACEHOLDER: 'Search by account number',
          TYPE_TO_SEARCH: 'Type to search',
        },
      },
    },
    COMMON: {
      ACTIONS: { CANCEL: 'Cancel' },
      NOTIFICATIONS: { LOAD_ERROR: 'Loading failed.' },
    },
    TREASURY: {
      ERRORS: {
        POST_TRANSACTION_FAILED: 'The treasury transaction could not be posted.',
      },
      TRANSACTIONS: {
        CREATE: {
          SUBMIT: 'Post transaction',
          TITLE: 'Post treasury transaction',
        },
        DIRECTIONS: {
          INFLOW: 'Inflow',
          OUTFLOW: 'Outflow',
        },
        FIELDS: {
          AMOUNT: 'Amount',
          COUNTERPARTY: 'Counterparty account to post',
          DATE: 'Date',
          DIRECTION: 'Direction',
          JOURNAL: 'Journal',
          LABEL: 'Label',
          TREASURY_ACCOUNT: 'Treasury account',
          VOUCHER: 'Voucher',
          YEAR: 'Fiscal year',
        },
        JOURNALS: {
          BANK: 'Bank',
          MISC: 'Miscellaneous',
        },
        VALIDATION: {
          COUNTERPARTY_REQUIRED: 'Select an active counterparty account.',
          COUNTERPARTY_SELF:
            'The counterparty account must be different from the treasury account.',
        },
      },
    },
  },
};

const dialogData = {
  accounts: [
    {
      orgId: 'org-test',
      treasuryAccountId: 'treasury-521',
      accountId: '52100000',
      label: 'Main bank',
      type: 'BANK' as const,
      currency: 'XOF',
      openingBalance: 0,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  selectedAccountId: 'treasury-521',
  year: '2026',
};

describe('CreateTreasuryTransactionDialogComponent', () => {
  let fixture: ComponentFixture<CreateTreasuryTransactionDialogComponent>;
  let treasuryApi: { postTransaction: ReturnType<typeof vi.fn> };
  let accountingApi: { listAccounts: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    treasuryApi = {
      postTransaction: vi.fn(),
    };
    accountingApi = {
      listAccounts: vi.fn(),
    };
    dialogRef = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        CreateTreasuryTransactionDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en',
          },
        }),
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: TreasuryApi, useValue: treasuryApi },
        { provide: AccountingApi, useValue: accountingApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateTreasuryTransactionDialogComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('renders the account search selector for the counterparty account', () => {
    const selector = fixture.debugElement.query(By.directive(AccountSearchSelectComponent))
      .componentInstance as AccountSearchSelectComponent;

    expect(selector.labelKey()).toBe('TREASURY.TRANSACTIONS.FIELDS.COUNTERPARTY');
    expect(selector.excludedAccountIds()).toEqual(['52100000']);
    expect(fixture.nativeElement.textContent).toContain('Example helper.');
  });

  it('searches only active accounting accounts through the selector', async () => {
    vi.useFakeTimers();
    accountingApi.listAccounts.mockResolvedValue({ items: [], hasMore: false });

    const input = fixture.nativeElement.querySelector(
      'liass-account-search-select input',
    ) as HTMLInputElement;
    input.focus();
    input.value = '411';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    await vi.advanceTimersByTimeAsync(275);

    expect(accountingApi.listAccounts).toHaveBeenCalledWith({
      activeOnly: true,
      limit: 20,
      search: '411',
    });
  });

  it('submits the selected counterparty account in the backend payload', async () => {
    treasuryApi.postTransaction.mockResolvedValue('entry-1');
    fillValidForm({ counterpartyAccountId: '41100000', direction: 'INFLOW' });

    await fixture.componentInstance['submit']();

    expect(treasuryApi.postTransaction).toHaveBeenCalledWith({
      treasuryAccountId: 'treasury-521',
      year: 2026,
      entryDate: '2026-01-15',
      journalCode: 'BANK',
      direction: 'INFLOW',
      amount: 150000,
      counterpartyAccountId: '41100000',
      label: 'Customer receipt',
      voucherNumber: 'REC-1',
    });
    expect(dialogRef.close).toHaveBeenCalledWith('entry-1');
  });

  it('does not allow the selected treasury account as counterparty', async () => {
    fillValidForm({ counterpartyAccountId: '52100000' });

    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(treasuryApi.postTransaction).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'The counterparty account must be different from the treasury account.',
    );
  });

  it('supports outflow operations with the selected counterparty account', async () => {
    treasuryApi.postTransaction.mockResolvedValue('entry-2');
    fillValidForm({ counterpartyAccountId: '40100000', direction: 'OUTFLOW' });

    await fixture.componentInstance['submit']();

    expect(treasuryApi.postTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUTFLOW',
        counterpartyAccountId: '40100000',
      }),
    );
  });

  function fillValidForm(
    overrides: Partial<{ counterpartyAccountId: string; direction: 'INFLOW' | 'OUTFLOW' }> = {},
  ): void {
    fixture.componentInstance['form'].patchValue({
      treasuryAccountId: 'treasury-521',
      year: 2026,
      entryDate: '2026-01-15',
      journalCode: 'BANK',
      direction: overrides.direction ?? 'INFLOW',
      amount: 150000,
      counterpartyAccountId: overrides.counterpartyAccountId ?? '41100000',
      label: 'Customer receipt',
      voucherNumber: 'REC-1',
    });
  }
});
