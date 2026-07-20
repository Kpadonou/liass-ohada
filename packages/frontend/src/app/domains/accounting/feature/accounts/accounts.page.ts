import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { LiassTablePreferencesDialogComponent } from '../../../../shared/ui/table-preferences/table-preferences-dialog.component';
import { type LiassTableColumnPreference } from '../../../../shared/ui/table-preferences/table-preferences.model';
import {
  loadTablePreferences,
  saveTablePreferences
} from '../../../../shared/ui/table-preferences/table-preferences.storage';
import { AccountingApi, type PaginatedResult } from '../../data-access/accounting.api';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { AccountDialogComponent } from './account-dialog.component';
import { DisableAccountDialogComponent } from './disable-account-dialog.component';

type ClassFilter = 'ALL' | number;
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type AccountTableColumnId =
  | 'code'
  | 'name'
  | 'class'
  | 'nature'
  | 'usage'
  | 'status'
  | 'flags'
  | 'actions';

const ACCOUNT_PAGE_SIZE = 100;
const ACCOUNT_SEARCH_DEBOUNCE_MS = 300;
const ACCOUNTING_ACCOUNTS_TABLE_ID = 'accounting.accounts';
const ACCOUNT_TABLE_COLUMNS: LiassTableColumnPreference[] = [
  { id: 'code', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.CODE', required: true },
  { id: 'name', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.NAME', required: true },
  { id: 'class', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.CLASS' },
  { id: 'nature', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.NATURE' },
  { id: 'usage', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.USAGE' },
  { id: 'status', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.STATUS' },
  { id: 'flags', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.FLAGS' },
  { id: 'actions', labelKey: 'ACCOUNTING.ACCOUNTS.TABLE.ACTIONS', required: true }
];

@Component({
  selector: 'liass-accounts-page',
  host: {
    class: 'block'
  },
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatSidenavModule,
    TranslocoModule
  ],
  templateUrl: './accounts.page.html'
})
export class AccountsPage implements OnDestroy {
  protected readonly authStore = inject(AuthStore);
  protected readonly canWriteAccounting = () => !this.authStore.isAccountingReadOnly?.();
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);

  protected readonly classCodes = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  protected readonly searchInput = signal('');
  protected readonly searchQuery = signal('');
  protected readonly classFilter = signal<ClassFilter>('ALL');
  protected readonly statusFilter = signal<StatusFilter>('ALL');
  protected readonly extraPages = signal<PaginatedResult<AccountDto>[]>([]);
  protected readonly localAccountUpserts = signal<AccountDto[]>([]);
  protected readonly loadMoreError = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly selectedAccount = signal<AccountDto | null>(null);
  protected readonly visibleColumnIds = signal(
    loadTablePreferences(ACCOUNTING_ACCOUNTS_TABLE_ID, ACCOUNT_TABLE_COLUMNS)
  );
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly accountsQuery = injectQuery(() =>
    this.accountingQueries.listAccounts(this.listRequest())
  );

  protected readonly allAccounts = computed(() => [
    ...mergeAccounts(
      [
        ...(this.accountsQuery.data()?.items ?? []),
        ...this.extraPages().flatMap((page) => page.items)
      ],
      this.localAccountUpserts()
    )
  ]);

  protected readonly filteredAccounts = computed(() => {
    const query = this.searchQuery();
    const classFilter = this.classFilter();
    const statusFilter = this.statusFilter();

    return this.allAccounts().filter((account) => {
      const matchesClass = classFilter === 'ALL' || account.classCode === classFilter;
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && account.isActive !== false) ||
        (statusFilter === 'INACTIVE' && account.isActive === false);

      return matchesClass && matchesStatus && (!query || account.accountId.startsWith(query));
    });
  });

  protected readonly hasLoadedAccounts = computed(() => this.allAccounts().length > 0);
  protected readonly hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      this.classFilter() !== 'ALL' ||
      this.statusFilter() !== 'ALL'
  );

  protected readonly nextCursor = computed(() => {
    const extraPages = this.extraPages();
    const lastPage = extraPages.at(-1) ?? this.accountsQuery.data();

    return lastPage?.nextCursor ?? null;
  });

  protected readonly hasMoreAccounts = computed(() => {
    const extraPages = this.extraPages();
    const lastPage = extraPages.at(-1) ?? this.accountsQuery.data();

    return !!lastPage?.hasMore && !!lastPage.nextCursor;
  });

  protected updateSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(0, 8);

    input.value = value;
    this.searchInput.set(value);

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      this.searchQuery.set(value);
      this.resetPagination();
    }, ACCOUNT_SEARCH_DEBOUNCE_MS);
  }

  protected updateClassFilter(value: ClassFilter): void {
    this.classFilter.set(value);
    this.resetPagination();
  }

  protected updateStatusFilter(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.resetPagination();
  }

  protected clearFilters(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    this.searchInput.set('');
    this.searchQuery.set('');
    this.classFilter.set('ALL');
    this.statusFilter.set('ALL');
    this.resetPagination();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

  protected isColumnVisible(columnId: AccountTableColumnId): boolean {
    return this.visibleColumnIds().includes(columnId);
  }

  protected openTablePreferences(): void {
    const dialogRef = this.dialog.open(LiassTablePreferencesDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        columns: ACCOUNT_TABLE_COLUMNS,
        tableId: ACCOUNTING_ACCOUNTS_TABLE_ID,
        visibleColumnIds: this.visibleColumnIds()
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '560px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
      if (!result) {
        return;
      }

      this.visibleColumnIds.set(
        saveTablePreferences(
          ACCOUNTING_ACCOUNTS_TABLE_ID,
          ACCOUNT_TABLE_COLUMNS,
          result.visibleColumnIds
        )
      );
    });
  }

  protected async retryInitialLoad(): Promise<void> {
    this.extraPages.set([]);
    this.loadMoreError.set(false);
    await this.accountsQuery.refetch();
  }

  protected async loadMoreAccounts(): Promise<void> {
    const cursor = this.nextCursor();

    if (!cursor || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.loadMoreError.set(false);

    try {
      const page = await this.accountingApi.listAccounts({
        ...this.listRequest(),
        cursor,
      });
      this.extraPages.update((pages) => [...pages, page]);
    } catch {
      this.loadMoreError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected openCreateAccount(): void {
    const dialogRef = this.dialog.open(AccountDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { mode: 'create' },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((account: AccountDto | null | undefined) => {
      if (account) {
        this.upsertAccount(account);
      }
    });
  }

  protected openEditAccount(account: AccountDto): void {
    if (!this.isAccountActive(account)) {
      return;
    }

    const dialogRef = this.dialog.open(AccountDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { account, mode: 'edit' },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((updatedAccount: AccountDto | null | undefined) => {
      if (updatedAccount) {
        this.upsertAccount(updatedAccount);
      }
    });
  }

  protected openAccountDetails(account: AccountDto): void {
    this.selectedAccount.set(account);
  }

  protected closeAccountDetails(): void {
    this.selectedAccount.set(null);
  }

  protected openDisableAccount(account: AccountDto): void {
    if (!this.isAccountActive(account)) {
      return;
    }

    const dialogRef = this.dialog.open(DisableAccountDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { account },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '520px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((disabledAccount: AccountDto | null | undefined) => {
      if (disabledAccount) {
        this.upsertAccount(disabledAccount);
      }
    });
  }

  protected isAccountActive(account: AccountDto): boolean {
    return account.isActive !== false;
  }

  protected accountStatusTone(account: AccountDto): 'success' | 'neutral' {
    return this.isAccountActive(account) ? 'success' : 'neutral';
  }

  protected accountStatusKey(account: AccountDto): string {
    return this.isAccountActive(account)
      ? 'ACCOUNTING.ACCOUNTS.STATUS.ACTIVE'
      : 'ACCOUNTING.ACCOUNTS.STATUS.INACTIVE';
  }

  private upsertAccount(account: AccountDto): void {
    this.loadMoreError.set(false);
    this.localAccountUpserts.update((accounts) =>
      mergeAccounts(accounts, [account])
    );
    this.upsertAccountCache(account);

    if (this.selectedAccount()?.accountId === account.accountId) {
      this.selectedAccount.set(account);
    }
  }

  private listRequest() {
    return {
      limit: ACCOUNT_PAGE_SIZE,
      ...(this.searchQuery() ? { search: this.searchQuery() } : {}),
      ...(this.classFilter() !== 'ALL' ? { class: this.classFilter() } : {}),
      ...(this.statusFilter() === 'ACTIVE' ? { active: true } : {}),
      ...(this.statusFilter() === 'INACTIVE' ? { active: false } : {})
    };
  }

  private resetPagination(): void {
    this.extraPages.set([]);
    this.loadMoreError.set(false);
  }

  private upsertAccountCache(account: AccountDto): void {
    this.queryClient.setQueriesData<PaginatedResult<AccountDto>>(
      { queryKey: this.accountingQueries.accountsRootQueryKey() },
      (page) =>
        page
          ? {
              ...page,
              items: mergeAccounts(page.items, [account])
            }
          : page
    );
    this.queryClient.setQueryData(
      this.accountingQueries.account(account.accountId).queryKey,
      account
    );
  }
}

function mergeAccounts(baseAccounts: AccountDto[], upserts: AccountDto[]): AccountDto[] {
  const accountsById = new Map<string, AccountDto>();

  for (const account of baseAccounts) {
    accountsById.set(account.accountId, account);
  }

  for (const account of upserts) {
    accountsById.set(account.accountId, account);
  }

  return [...accountsById.values()].sort((left, right) =>
    left.accountId.localeCompare(right.accountId)
  );
}
