import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingApi } from '../../data-access/accounting.api';
import { AccountSearchSelectComponent } from './account-search-select.component';

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
      }
    },
    COMMON: {
      NOTIFICATIONS: {
        LOAD_ERROR: 'Loading failed.'
      }
    }
  }
};

@Component({
  imports: [AccountSearchSelectComponent, ReactiveFormsModule],
  template: `<liass-account-search-select [formControl]="control" [auxiliaryType]="auxiliaryType" />`
})
class AccountSearchSelectHostComponent {
  control = new FormControl<string | null>(null);
  auxiliaryType: 'CUSTOMER' | 'SUPPLIER' | null = null;
}

describe('AccountSearchSelectComponent', () => {
  let fixture: ComponentFixture<AccountSearchSelectHostComponent>;
  let accountingApi: {
    getAccount: ReturnType<typeof vi.fn>;
    listAccounts: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    accountingApi = {
      getAccount: vi.fn(),
      listAccounts: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        AccountSearchSelectHostComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [{ provide: AccountingApi, useValue: accountingApi }]
    }).compileComponents();

    fixture = TestBed.createComponent(AccountSearchSelectHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('debounces code-prefix input and searches remotely instead of preloading 200 accounts', async () => {
    vi.useFakeTimers();
    accountingApi.listAccounts.mockResolvedValue({ items: [], hasMore: false });

    typeSearch('411');
    await vi.advanceTimersByTimeAsync(274);
    expect(accountingApi.listAccounts).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(accountingApi.listAccounts).toHaveBeenCalledWith({
      activeOnly: true,
      limit: 20,
      search: '411'
    });
    expect(accountingApi.listAccounts).not.toHaveBeenCalledWith({ limit: 200 });
  });

  it('shows the search guidance only while the empty field is focused', () => {
    expect(fixture.nativeElement.textContent).not.toContain('Type to search');

    inputElement().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Type to search');

    inputElement().dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Type to search');
  });

  it('shows loading and no-result states', async () => {
    vi.useFakeTimers();
    let resolveSearch!: (value: { items: []; hasMore: false }) => void;
    accountingApi.listAccounts.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      })
    );

    typeSearch('521');
    await vi.advanceTimersByTimeAsync(275);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('Searching accounts...');

    resolveSearch({ items: [], hasMore: false });
    await vi.runAllTimersAsync();
    fixture.detectChanges();
    openAutocomplete();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('No accounts found');
  });

  it('preserves a selected account outside the current result page without preloading', async () => {
    fixture.componentInstance.control.setValue('70110000');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(accountingApi.getAccount).not.toHaveBeenCalled();
    expect(inputElement().value).toBe('70110000');
    expect(fixture.componentInstance.control.value).toBe('70110000');
  });

  it('loads the next search page and emits only the selected account identifier', async () => {
    vi.useFakeTimers();
    accountingApi.listAccounts
      .mockResolvedValueOnce({
        items: [accountFixture('41110000', 'Clients')],
        nextCursor: 'cursor-2',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [accountFixture('41120000', 'Group clients')],
        hasMore: false
      });

    typeSearch('411');
    await vi.advanceTimersByTimeAsync(275);
    fixture.detectChanges();

    const component = fixture.debugElement.query(
      By.directive(AccountSearchSelectComponent)
    ).componentInstance as any;
    await component.loadMore();
    fixture.detectChanges();

    expect(accountingApi.listAccounts).toHaveBeenLastCalledWith({
      activeOnly: true,
      cursor: 'cursor-2',
      limit: 20,
      search: '411'
    });

    component.selectOption({ option: { value: '41120000' } });
    expect(fixture.componentInstance.control.value).toBe('41120000');
  });

  it('does not search or show a no-result message when a selected account is focused again', async () => {
    vi.useFakeTimers();
    accountingApi.listAccounts.mockResolvedValue({
      items: [accountFixture('52000000', 'Banks')],
      hasMore: false
    });

    typeSearch('52');
    await vi.advanceTimersByTimeAsync(275);
    fixture.detectChanges();

    const component = fixture.debugElement.query(
      By.directive(AccountSearchSelectComponent)
    ).componentInstance as any;
    component.selectOption({ option: { value: '52000000' } });
    fixture.detectChanges();
    accountingApi.listAccounts.mockClear();

    inputElement().dispatchEvent(new Event('focus'));
    inputElement().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(275);

    expect(accountingApi.listAccounts).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('No accounts found');
  });

  it('does not display unrelated first-page accounts when a legacy backend ignores search', async () => {
    vi.useFakeTimers();
    accountingApi.listAccounts.mockResolvedValue({
      items: [accountFixture('10000000', 'Capital social')],
      hasMore: false
    });

    typeSearch('22');
    await vi.advanceTimersByTimeAsync(275);
    fixture.detectChanges();

    const component = fixture.debugElement.query(
      By.directive(AccountSearchSelectComponent)
    ).componentInstance as any;
    expect(component.visibleAccounts()).toEqual([]);
  });

  it('keeps legacy SYSCOHADA customer accounts selectable when auxiliary metadata is missing', async () => {
    vi.useFakeTimers();
    fixture.componentInstance.auxiliaryType = 'CUSTOMER';
    accountingApi.listAccounts.mockResolvedValue({
      items: [
        accountFixture('41110000', 'Clients', {
          auxiliaryType: undefined,
          requiresThirdParty: undefined
        }),
        accountFixture('40110000', 'Fournisseurs', {
          auxiliaryType: undefined,
          requiresThirdParty: undefined
        })
      ],
      hasMore: false
    });

    typeSearch('411');
    await vi.advanceTimersByTimeAsync(275);
    fixture.detectChanges();

    const component = fixture.debugElement.query(
      By.directive(AccountSearchSelectComponent)
    ).componentInstance as any;
    expect(component.visibleAccounts().map((account: { accountId: string }) => account.accountId)).toEqual([
      '41110000'
    ]);
  });

  function typeSearch(value: string): void {
    const input = inputElement();
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function openAutocomplete(): void {
    inputElement().focus();
    inputElement().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function inputElement(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }
});

function accountFixture(
  accountId: string,
  accountName: string,
  overrides: Partial<{
    auxiliaryType: 'CUSTOMER' | 'SUPPLIER' | 'THIRD_PARTY' | 'NONE';
    requiresThirdParty: boolean;
  }> = {}
) {
  return {
    accountId,
    accountName,
    accountNature: 'BALANCE' as const,
    accountUsage: 'BOTH' as const,
    isThirdPartyAccount: accountId.startsWith('4'),
    classCode: Number(accountId[0]) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    financialStatementCode: 'BS',
    allowReconciliation: accountId.startsWith('4'),
    isActive: true,
    ...overrides
  };
}
