import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { Router } from '@angular/router';
import { type JournalDto } from '@liass-ohada/shared/accounting';
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
import { AccountingQueries } from '../../data-access/accounting-queries';
import { CreateJournalDialogComponent } from './create-journal-dialog.component';
import { DisableJournalDialogComponent } from './disable-journal-dialog.component';

type JournalTypeFilter = 'ALL' | JournalDto['type'];
type SystemFilter = 'ALL' | 'SYSTEM' | 'STANDARD';
type JournalTableColumnId = 'code' | 'name' | 'type' | 'year' | 'status' | 'system' | 'actions';

const SYSTEM_JOURNAL_CODES = new Set(['RAN', 'OD', 'CLOSING']);
const ACCOUNTING_JOURNALS_TABLE_ID = 'accounting.journals';
const JOURNAL_TABLE_COLUMNS: LiassTableColumnPreference[] = [
  { id: 'code', labelKey: 'ACCOUNTING.JOURNALS.TABLE.CODE', required: true },
  { id: 'name', labelKey: 'ACCOUNTING.JOURNALS.TABLE.NAME', required: true },
  { id: 'type', labelKey: 'ACCOUNTING.JOURNALS.TABLE.TYPE' },
  { id: 'year', labelKey: 'ACCOUNTING.JOURNALS.TABLE.YEAR' },
  { id: 'status', labelKey: 'ACCOUNTING.JOURNALS.TABLE.STATUS' },
  { id: 'system', labelKey: 'ACCOUNTING.JOURNALS.TABLE.SYSTEM' },
  { id: 'actions', labelKey: 'ACCOUNTING.JOURNALS.TABLE.ACTIONS', required: true }
];

@Component({
  selector: 'liass-journals-page',
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
  templateUrl: './journals.page.html'
})
export class JournalsPage {
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  protected readonly searchQuery = signal('');
  protected readonly typeFilter = signal<JournalTypeFilter>('ALL');
  protected readonly systemFilter = signal<SystemFilter>('ALL');
  protected readonly localJournalUpserts = signal<JournalDto[]>([]);
  protected readonly removedJournalCodes = signal(new Set<string>());
  protected readonly selectedJournal = signal<JournalDto | null>(null);
  protected readonly visibleColumnIds = signal(
    loadTablePreferences(ACCOUNTING_JOURNALS_TABLE_ID, JOURNAL_TABLE_COLUMNS)
  );
  protected readonly journalsQuery = injectQuery(() => this.accountingQueries.listJournals());
  protected readonly journals = computed(() => {
    const removedJournalCodes = this.removedJournalCodes();

    return mergeJournals(this.journalsQuery.data() ?? [], this.localJournalUpserts()).filter(
      (journal) => !removedJournalCodes.has(journal.journalCode)
    );
  });
  protected readonly hasLoadedJournals = computed(() => this.journals().length > 0);
  protected readonly filteredJournals = computed(() => {
    const query = normalizeSearch(this.searchQuery());
    const type = this.typeFilter();
    const systemFilter = this.systemFilter();

    return this.journals().filter((journal) => {
      const matchesType = type === 'ALL' || journal.type === type;
      const isSystem = this.isSystemJournal(journal);
      const matchesSystem =
        systemFilter === 'ALL' ||
        (systemFilter === 'SYSTEM' && isSystem) ||
        (systemFilter === 'STANDARD' && !isSystem);
      const searchable = normalizeSearch(`${journal.journalCode} ${journal.journalName} ${journal.type}`);

      return matchesType && matchesSystem && (!query || searchable.includes(query));
    });
  });

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.searchQuery.set('');
    this.typeFilter.set('ALL');
    this.systemFilter.set('ALL');
  }

  protected isColumnVisible(columnId: JournalTableColumnId): boolean {
    return this.visibleColumnIds().includes(columnId);
  }

  protected openTablePreferences(): void {
    const dialogRef = this.dialog.open(LiassTablePreferencesDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        columns: JOURNAL_TABLE_COLUMNS,
        tableId: ACCOUNTING_JOURNALS_TABLE_ID,
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
          ACCOUNTING_JOURNALS_TABLE_ID,
          JOURNAL_TABLE_COLUMNS,
          result.visibleColumnIds
        )
      );
    });
  }

  protected async retryInitialLoad(): Promise<void> {
    await this.journalsQuery.refetch();
  }

  protected openCreateJournal(): void {
    const dialogRef = this.dialog.open(CreateJournalDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { mode: 'create' },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '640px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((journal: JournalDto | null | undefined) => {
      if (journal) {
        this.upsertJournal(journal);
      }
    });
  }

  protected openEditJournal(journal: JournalDto): void {
    if (!this.canEditJournal(journal)) {
      return;
    }

    const dialogRef = this.dialog.open(CreateJournalDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { journal, mode: 'edit' },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '640px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((updatedJournal: JournalDto | null | undefined) => {
      if (updatedJournal) {
        this.upsertJournal(updatedJournal);
      }
    });
  }

  protected openJournalDetails(journal: JournalDto): void {
    this.selectedJournal.set(journal);
  }

  protected closeJournalDetails(): void {
    this.selectedJournal.set(null);
  }

  protected openDisableJournal(journal: JournalDto): void {
    if (!this.canDisableJournal(journal)) {
      return;
    }

    const dialogRef = this.dialog.open(DisableJournalDialogComponent, {
      autoFocus: 'first-tabbable',
      data: { journal },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '520px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((journalCode: string | null | undefined) => {
      if (journalCode) {
        this.removeJournal(journalCode);
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

  protected isSystemJournal(journal: JournalDto): boolean {
    return SYSTEM_JOURNAL_CODES.has(journal.journalCode.toUpperCase());
  }

  protected journalStatusKey(): string {
    return 'ACCOUNTING.JOURNALS.STATUS.ACTIVE';
  }

  protected journalSystemKey(journal: JournalDto): string {
    return this.isSystemJournal(journal)
      ? 'ACCOUNTING.JOURNALS.SYSTEM.SYSTEM'
      : 'ACCOUNTING.JOURNALS.SYSTEM.STANDARD';
  }

  protected journalSystemTone(journal: JournalDto): 'brand' | 'neutral' {
    return this.isSystemJournal(journal) ? 'brand' : 'neutral';
  }

  protected canEditJournal(journal: JournalDto): boolean {
    return !this.isSystemJournal(journal);
  }

  protected canDisableJournal(journal: JournalDto): boolean {
    return !this.isSystemJournal(journal);
  }

  private upsertJournal(journal: JournalDto): void {
    this.removedJournalCodes.update((journalCodes) => {
      const nextJournalCodes = new Set(journalCodes);
      nextJournalCodes.delete(journal.journalCode);
      return nextJournalCodes;
    });
    this.localJournalUpserts.update((journals) => mergeJournals(journals, [journal]));
    this.upsertJournalCache(journal);

    if (this.selectedJournal()?.journalCode === journal.journalCode) {
      this.selectedJournal.set(journal);
    }
  }

  private removeJournal(journalCode: string): void {
    this.removedJournalCodes.update((journalCodes) => new Set(journalCodes).add(journalCode));
    this.localJournalUpserts.update((journals) =>
      journals.filter((journal) => journal.journalCode !== journalCode)
    );
    this.removeJournalFromCache(journalCode);

    if (this.selectedJournal()?.journalCode === journalCode) {
      this.selectedJournal.set(null);
    }
  }

  private upsertJournalCache(journal: JournalDto): void {
    this.queryClient.setQueryData<JournalDto[]>(
      this.accountingQueries.journalsQueryKey(),
      (journals) => mergeJournals(journals ?? [], [journal])
    );
    this.queryClient.setQueryData(
      this.accountingQueries.journal(journal.journalCode).queryKey,
      journal
    );
  }

  private removeJournalFromCache(journalCode: string): void {
    this.queryClient.setQueryData<JournalDto[]>(
      this.accountingQueries.journalsQueryKey(),
      (journals) => (journals ?? []).filter((journal) => journal.journalCode !== journalCode)
    );
    this.queryClient.removeQueries({
      queryKey: this.accountingQueries.journal(journalCode).queryKey
    });
  }
}

function mergeJournals(baseJournals: JournalDto[], upserts: JournalDto[]): JournalDto[] {
  const journalsByCode = new Map<string, JournalDto>();

  for (const journal of baseJournals) {
    journalsByCode.set(journal.journalCode, journal);
  }

  for (const journal of upserts) {
    journalsByCode.set(journal.journalCode, journal);
  }

  return [...journalsByCode.values()].sort((left, right) =>
    left.journalCode.localeCompare(right.journalCode)
  );
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
