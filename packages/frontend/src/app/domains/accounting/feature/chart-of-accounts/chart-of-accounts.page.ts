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

import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { CreateAccountDialogComponent } from './create-account-dialog.component';

type ClassFilter = 'ALL' | number;

@Component({
  selector: 'liass-chart-of-accounts-page',
  imports: [
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
  templateUrl: './chart-of-accounts.page.html'
})
export class ChartOfAccountsPage {
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);

  protected readonly searchQuery = signal('');
  protected readonly classFilter = signal<ClassFilter>('ALL');
  protected readonly classCodes = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly accountsQuery = injectQuery(() => this.accountingQueries.listAccounts());
  protected readonly accounts = computed(() => this.accountsQuery.data()?.items ?? []);
  protected readonly thirdPartyAccountsCount = computed(
    () => this.accounts().filter((account) => account.isThirdPartyAccount).length
  );
  protected readonly filteredAccounts = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const classFilter = this.classFilter();

    return this.accounts().filter((account) => {
      const matchesClass = classFilter === 'ALL' || account.classCode === classFilter;
      const searchable = normalizeSearch(`${account.accountId} ${account.accountName}`);

      return matchesClass && (!query || searchable.includes(query));
    });
  });

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected openCreateAccount(): void {
    const dialogRef = this.dialog.open(CreateAccountDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '720px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((account: AccountDto | null | undefined) => {
      if (account) {
        void this.accountsQuery.refetch();
      }
    });
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
