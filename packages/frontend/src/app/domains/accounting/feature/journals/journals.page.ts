import { Component, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { type JournalDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { CreateJournalDialogComponent } from './create-journal-dialog.component';

type JournalTypeFilter = 'ALL' | JournalDto['type'];

@Component({
  selector: 'liass-journals-page',
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
  templateUrl: './journals.page.html'
})
export class JournalsPage {
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly searchQuery = signal('');
  protected readonly typeFilter = signal<JournalTypeFilter>('ALL');
  protected readonly journalsQuery = injectQuery(() => this.accountingQueries.listJournals());
  protected readonly journals = computed(() => this.journalsQuery.data() ?? []);
  protected readonly filteredJournals = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const type = this.typeFilter();

    return this.journals().filter((journal) => {
      const matchesType = type === 'ALL' || journal.type === type;
      const searchable = normalizeSearch(`${journal.journalCode} ${journal.journalName}`);

      return matchesType && (!query || searchable.includes(query));
    });
  });

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected openCreateJournal(): void {
    const dialogRef = this.dialog.open(CreateJournalDialogComponent, {
      autoFocus: 'first-tabbable',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '640px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((journal: JournalDto | null | undefined) => {
      if (journal) {
        void this.journalsQuery.refetch();
      }
    });
  }

  protected async viewEntries(journal: JournalDto): Promise<void> {
    await this.router.navigate(['/accounting/entries'], {
      queryParams: {
        journalCode: journal.journalCode,
        year: journal.year
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
