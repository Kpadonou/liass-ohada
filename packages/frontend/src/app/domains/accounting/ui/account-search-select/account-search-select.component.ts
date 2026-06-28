import {
  Component,
  computed,
  forwardRef,
  inject,
  input,
  OnDestroy,
  output,
  signal
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';

import { AccountingApi } from '../../data-access/accounting.api';

const ACCOUNT_SEARCH_DEBOUNCE_MS = 275;
const ACCOUNT_SEARCH_PAGE_SIZE = 20;
const LOAD_MORE_VALUE = '__LOAD_MORE_ACCOUNTS__';

@Component({
  selector: 'liass-account-search-select',
  host: {
    class: 'block'
  },
  imports: [
    MatAutocompleteModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslocoModule
  ],
  providers: [
    {
      multi: true,
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AccountSearchSelectComponent)
    }
  ],
  templateUrl: './account-search-select.component.html'
})
export class AccountSearchSelectComponent implements ControlValueAccessor, OnDestroy {
  readonly errorKey = input<string | null>(null);
  readonly labelKey = input('ACCOUNTING.ACCOUNTS.SELECT.LABEL');
  readonly showError = input(false);
  readonly auxiliaryType = input<'CUSTOMER' | 'SUPPLIER' | null>(null);
  readonly accountSelected = output<AccountDto | null>();

  private readonly accountingApi = inject(AccountingApi);
  private readonly selectedValue = signal<string | null>(null);
  protected readonly searchText = signal('');
  private readonly accounts = signal<AccountDto[]>([]);
  private readonly nextCursor = signal<string | null>(null);
  protected readonly hasMore = signal(false);
  private readonly requestSequence = signal(0);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private isPropagatingInput = false;

  protected readonly disabled = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly hasSearched = signal(false);
  protected readonly searchError = signal(false);
  protected readonly focused = signal(false);

  protected readonly visibleAccounts = computed(() => {
    const query = normalizeSearch(this.searchText());
    const accounts = this.accounts().filter((account) => this.matchesAuxiliaryType(account));

    if (!query) {
      return accounts;
    }

    if (/^\d+$/.test(query)) {
      return accounts.filter((account) => account.accountId.startsWith(query));
    }

    return accounts.filter((account) =>
      normalizeSearch(`${account.accountId} ${account.accountName}`).includes(query)
    );
  });

  protected readonly helperKey = computed(() => {
    if (!this.focused()) {
      return null;
    }

    const query = this.searchText().trim();

    if (!query) {
      return 'ACCOUNTING.ACCOUNTS.SELECT.TYPE_TO_SEARCH';
    }

    return null;
  });

  protected readonly showNoResults = computed(
    () =>
      this.focused() &&
      /^\d{1,8}$/.test(this.searchText().trim()) &&
      this.hasSearched() &&
      !this.loading() &&
      !this.searchError()
  );

  private onChange: (value: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  ngOnDestroy(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

  writeValue(value: string | null): void {
    const normalizedValue = value || null;
    this.selectedValue.set(normalizedValue);

    if (!normalizedValue) {
      if (!this.isPropagatingInput) {
        this.searchText.set('');
      }
      return;
    }

    const selectedAccount = this.accounts().find(
      (account) => account.accountId === normalizedValue
    );

    if (selectedAccount) {
      this.searchText.set(this.accountLabel(selectedAccount));
      return;
    }

    this.searchText.set(normalizedValue);
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected handleInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchText.set(value);
    this.searchError.set(false);
    this.selectedValue.set(null);
    this.propagateNullFromInput();
    this.accountSelected.emit(null);

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    const query = value.trim();
    if (!/^\d{1,8}$/.test(query)) {
      this.requestSequence.update((sequence) => sequence + 1);
      this.loading.set(false);
      this.hasSearched.set(false);
      this.nextCursor.set(null);
      this.hasMore.set(false);
      return;
    }

    this.searchTimer = setTimeout(() => {
      void this.searchAccounts(query);
    }, ACCOUNT_SEARCH_DEBOUNCE_MS);
  }

  protected handleFocus(): void {
    this.focused.set(true);
  }

  protected handleBlur(): void {
    this.focused.set(false);
    this.onTouched();
    window.setTimeout(() => this.syncInputToSelectedValue(), 100);
  }

  protected selectOption(event: MatAutocompleteSelectedEvent): void {
    const value = `${event.option.value}`;

    if (value === LOAD_MORE_VALUE) {
      void this.loadMore();
      return;
    }

    const selectedAccount = this.accounts().find(
      (account) => account.accountId === value
    );
    this.selectedValue.set(value);
    this.onChange(value);
    this.accountSelected.emit(selectedAccount ?? null);
    this.searchText.set(selectedAccount ? this.accountLabel(selectedAccount) : value);
    this.hasSearched.set(false);
    this.searchError.set(false);
    this.nextCursor.set(null);
    this.hasMore.set(false);
  }

  protected accountLabel(account: AccountDto): string {
    return `${account.accountId} — ${account.accountName}`;
  }

  protected loadMoreValue(): string {
    return LOAD_MORE_VALUE;
  }

  private async searchAccounts(search: string): Promise<void> {
    const requestId = this.requestSequence() + 1;
    this.requestSequence.set(requestId);
    this.loading.set(true);
    this.hasSearched.set(true);

    try {
      const result = await this.accountingApi.listAccounts({
        activeOnly: true,
        limit: ACCOUNT_SEARCH_PAGE_SIZE,
        search
      });

      if (requestId !== this.requestSequence()) {
        return;
      }

      const selectedAccount = this.selectedAccount();
      this.accounts.set(
        mergeAccounts(selectedAccount ? [selectedAccount] : [], result.items)
      );
      this.nextCursor.set(result.nextCursor ?? null);
      this.hasMore.set(result.hasMore && !!result.nextCursor);
    } catch {
      if (requestId === this.requestSequence()) {
        this.searchError.set(true);
        this.accounts.set(this.selectedAccount() ? [this.selectedAccount()!] : []);
        this.nextCursor.set(null);
        this.hasMore.set(false);
      }
    } finally {
      if (requestId === this.requestSequence()) {
        this.loading.set(false);
      }
    }
  }

  private async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    const search = this.remoteSearchPrefix();

    if (!cursor || !search || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);

    try {
      const result = await this.accountingApi.listAccounts({
        activeOnly: true,
        cursor,
        limit: ACCOUNT_SEARCH_PAGE_SIZE,
        search
      });
      this.accounts.update((accounts) => mergeAccounts(accounts, result.items));
      this.nextCursor.set(result.nextCursor ?? null);
      this.hasMore.set(result.hasMore && !!result.nextCursor);
    } catch {
      this.searchError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private selectedAccount(): AccountDto | null {
    const value = this.selectedValue();
    return this.accounts().find((account) => account.accountId === value) ?? null;
  }

  private remoteSearchPrefix(): string | null {
    const query = this.searchText().trim();
    return /^\d{1,8}$/.test(query) ? query : null;
  }

  private syncInputToSelectedValue(): void {
    const value = this.selectedValue();

    if (!value) {
      this.searchText.set('');
      return;
    }

    const selectedAccount = this.selectedAccount();
    this.searchText.set(selectedAccount ? this.accountLabel(selectedAccount) : value);
  }

  private matchesAuxiliaryType(account: AccountDto): boolean {
    const auxiliaryType = this.auxiliaryType();

    if (!auxiliaryType) {
      return true;
    }

    if (account.requiresThirdParty === true && account.auxiliaryType === auxiliaryType) {
      return true;
    }

    if (account.requiresThirdParty === true || account.auxiliaryType === auxiliaryType) {
      return account.requiresThirdParty === true && account.auxiliaryType === auxiliaryType;
    }

    if (auxiliaryType === 'CUSTOMER') {
      return account.accountId.startsWith('411');
    }

    if (auxiliaryType === 'SUPPLIER') {
      return account.accountId.startsWith('401');
    }

    return false;
  }

  private propagateNullFromInput(): void {
    this.isPropagatingInput = true;
    this.onChange(null);
    queueMicrotask(() => {
      this.isPropagatingInput = false;
    });
  }
}

function mergeAccounts(
  first: readonly AccountDto[],
  second: readonly AccountDto[]
): AccountDto[] {
  const accounts = new Map<string, AccountDto>();

  for (const account of [...first, ...second]) {
    accounts.set(account.accountId, account);
  }

  return [...accounts.values()];
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
