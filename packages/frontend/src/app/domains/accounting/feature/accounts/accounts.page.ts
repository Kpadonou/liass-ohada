import { Component, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type AccountDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi, type PaginatedResult } from '../../data-access/accounting.api';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AccountDialogComponent } from './account-dialog.component';

type ClassFilter = 'ALL' | number;
type NatureFilter = 'ALL' | AccountDto['accountNature'];
type ThirdPartyFilter = 'ALL' | 'YES' | 'NO';

const ACCOUNT_PAGE_SIZE = 200;

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
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslocoModule
  ],
  templateUrl: './accounts.page.html'
})
export class AccountsPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);

  protected readonly classCodes = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  protected readonly searchQuery = signal('');
  protected readonly classFilter = signal<ClassFilter>('ALL');
  protected readonly natureFilter = signal<NatureFilter>('ALL');
  protected readonly thirdPartyFilter = signal<ThirdPartyFilter>('ALL');
  protected readonly extraPages = signal<PaginatedResult<AccountDto>[]>([]);
  protected readonly localAccountUpserts = signal<AccountDto[]>([]);
  protected readonly loadMoreError = signal(false);
  protected readonly loadingMore = signal(false);

  protected readonly accountsQuery = injectQuery(() =>
    this.accountingQueries.listAccounts({ limit: ACCOUNT_PAGE_SIZE })
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

  protected readonly thirdPartyAccountsCount = computed(
    () => this.allAccounts().filter((account) => account.isThirdPartyAccount).length
  );

  protected readonly filteredAccounts = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const classFilter = this.classFilter();
    const natureFilter = this.natureFilter();
    const thirdPartyFilter = this.thirdPartyFilter();

    return this.allAccounts().filter((account) => {
      const matchesClass = classFilter === 'ALL' || account.classCode === classFilter;
      const matchesNature = natureFilter === 'ALL' || account.accountNature === natureFilter;
      const matchesThirdParty =
        thirdPartyFilter === 'ALL' ||
        (thirdPartyFilter === 'YES' && account.isThirdPartyAccount) ||
        (thirdPartyFilter === 'NO' && !account.isThirdPartyAccount);
      const searchable = normalizeSearch(
        `${account.accountId} ${account.accountName} ${account.financialStatementCode}`
      );

      return matchesClass && matchesNature && matchesThirdParty && (!query || searchable.includes(query));
    });
  });

  protected readonly hasLoadedAccounts = computed(() => this.allAccounts().length > 0);

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
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.searchQuery.set('');
    this.classFilter.set('ALL');
    this.natureFilter.set('ALL');
    this.thirdPartyFilter.set('ALL');
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
        cursor,
        limit: ACCOUNT_PAGE_SIZE
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

  private upsertAccount(account: AccountDto): void {
    this.loadMoreError.set(false);
    this.localAccountUpserts.update((accounts) =>
      mergeAccounts(accounts, [account])
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

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
