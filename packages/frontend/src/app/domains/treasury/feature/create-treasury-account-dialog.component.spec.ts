import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { AccountSearchSelectComponent } from '../../accounting/ui/account-search-select/account-search-select.component';
import { TreasuryApi } from '../data-access/treasury.api';
import { CreateTreasuryAccountDialogComponent } from './create-treasury-account-dialog.component';

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
          TYPE_TO_SEARCH: 'Type to search'
        }
      }
    },
    COMMON: {
      ACTIONS: { CANCEL: 'Cancel' },
      NOTIFICATIONS: { LOAD_ERROR: 'Loading failed.' }
    },
    TREASURY: {
      ACCOUNTS: {
        CREATE: {
          ACCOUNT_REQUIRED: 'Select an active SYSCOHADA class 5 account.',
          SUBMIT: 'Create account',
          TITLE: 'Create treasury account'
        },
        FIELDS: {
          ACCOUNT_ID: 'SYSCOHADA class 5 account',
          BANK_ACCOUNT_NUMBER: 'Bank account number',
          BANK_NAME: 'Bank',
          CURRENCY: 'Currency',
          LABEL: 'Label',
          OPENING_BALANCE: 'Opening balance',
          TYPE: 'Type'
        },
        TYPES: { BANK: 'Bank', CASH: 'Cash', MOBILE_MONEY: 'Mobile money' }
      },
      ERRORS: {
        CREATE_ACCOUNT_FAILED: 'The treasury account could not be created.'
      }
    }
  }
};

describe('CreateTreasuryAccountDialogComponent', () => {
  let fixture: ComponentFixture<CreateTreasuryAccountDialogComponent>;
  let treasuryApi: { createAccount: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    treasuryApi = {
      createAccount: vi.fn()
    };
    dialogRef = {
      close: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        CreateTreasuryAccountDialogComponent,
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
        { provide: TreasuryApi, useValue: treasuryApi },
        { provide: MatDialogRef, useValue: dialogRef }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CreateTreasuryAccountDialogComponent);
    fixture.detectChanges();
  });

  it('requires an active class 5 account selection through the account selector', async () => {
    const selector = fixture.debugElement.query(By.directive(AccountSearchSelectComponent))
      .componentInstance as AccountSearchSelectComponent;

    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(selector.accountClass()).toBe(5);
    expect(treasuryApi.createAccount).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Select an active SYSCOHADA class 5 account.');
  });

  it('submits the selected linked account id in the backend payload', async () => {
    treasuryApi.createAccount.mockResolvedValue({
      orgId: 'org-test',
      treasuryAccountId: '52100000',
      accountId: '52100000',
      label: 'Main bank',
      type: 'BANK',
      currency: 'XOF',
      openingBalance: 0,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
    fixture.componentInstance['form'].patchValue({
      accountId: '52100000',
      label: 'Main bank',
      type: 'BANK',
      currency: 'XOF',
      bankName: 'Bank',
      bankAccountNumber: '123',
      openingBalance: 0
    });

    await fixture.componentInstance['submit']();

    expect(treasuryApi.createAccount).toHaveBeenCalledWith({
      accountId: '52100000',
      label: 'Main bank',
      type: 'BANK',
      currency: 'XOF',
      bankName: 'Bank',
      bankAccountNumber: '123',
      openingBalance: 0
    });
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ treasuryAccountId: '52100000' })
    );
  });

  it('shows safe backend validation errors for duplicate or invalid accounts', async () => {
    treasuryApi.createAccount.mockRejectedValue(
      new HttpErrorResponse({
        error: {
          message: {
            code: 'ERROR_TREASURY_ACCOUNT_ALREADY_EXISTS',
            message: 'This treasury account already exists.'
          }
        },
        status: 400
      })
    );
    fixture.componentInstance['form'].patchValue({
      accountId: '52100000',
      label: 'Main bank',
      type: 'BANK',
      currency: 'XOF',
      openingBalance: 0
    });

    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('This treasury account already exists.');
    expect(fixture.nativeElement.textContent).not.toContain('ERROR_TREASURY_ACCOUNT_ALREADY_EXISTS');
  });
});
