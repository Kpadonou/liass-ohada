import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { type EntrySummaryDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
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
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

type EntryStatusFilter = 'ALL' | EntrySummaryDto['status'];
type EntryTableColumnId = 'date' | 'journal' | 'reference' | 'label' | 'debit' | 'credit' | 'status' | 'actions';

const ACCOUNTING_ENTRIES_TABLE_ID = 'accounting.entries';
const ENTRY_TABLE_COLUMNS: LiassTableColumnPreference[] = [
  { id: 'date', labelKey: 'ACCOUNTING.ENTRIES.TABLE.DATE', required: true },
  { id: 'journal', labelKey: 'ACCOUNTING.ENTRIES.TABLE.JOURNAL', required: true },
  { id: 'reference', labelKey: 'ACCOUNTING.ENTRIES.TABLE.REFERENCE' },
  { id: 'label', labelKey: 'ACCOUNTING.ENTRIES.TABLE.LABEL', required: true },
  { id: 'debit', labelKey: 'ACCOUNTING.ENTRIES.TABLE.DEBIT' },
  { id: 'credit', labelKey: 'ACCOUNTING.ENTRIES.TABLE.CREDIT' },
  { id: 'status', labelKey: 'ACCOUNTING.ENTRIES.TABLE.STATUS' },
  { id: 'actions', labelKey: 'ACCOUNTING.ENTRIES.TABLE.ACTIONS', required: true }
];

@Component({
  selector: 'liass-entries-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    FiscalYearRequiredComponent,
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
    TranslocoModule
  ],
  templateUrl: './entries.page.html'
})
export class EntriesPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly dialog = inject(MatDialog);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly currentYear = `${new Date().getFullYear()}`;
  protected readonly selectedYear = signal(`${this.fiscalYearContext.activeYear() ?? this.currentYear}`);
  protected readonly selectedJournalCode = signal<string | null>(null);
  protected readonly selectedMonth = signal<string | null>(null);
  protected readonly selectedStatus = signal<EntryStatusFilter>('ALL');
  protected readonly searchQuery = signal('');
  protected readonly extraEntries = signal<EntrySummaryDto[]>([]);
  protected readonly paginationState = signal<{ nextCursor?: string; hasMore?: boolean }>({});
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal(false);
  protected readonly visibleColumnIds = signal(
    loadTablePreferences(ACCOUNTING_ENTRIES_TABLE_ID, ENTRY_TABLE_COLUMNS)
  );

  protected readonly journalsQuery = injectQuery(() => this.accountingQueries.listJournals());
  protected readonly entriesQuery = injectQuery(() =>
    this.accountingQueries.listEntries({
      year: this.selectedYear(),
      journalCode: this.selectedJournalCode() || undefined,
      month: this.selectedJournalCode() ? this.selectedMonth() || undefined : undefined,
      status: this.selectedStatusParam(),
      limit: 100
    }, this.fiscalYearContext.hasActiveFiscalYear())
  );

  protected readonly journals = computed(() => this.journalsQuery.data() ?? []);
  protected readonly entries = computed(() => [
    ...(this.entriesQuery.data()?.items ?? []),
    ...this.extraEntries()
  ]);
  protected readonly hasLoadedEntries = computed(() => this.entries().length > 0);
  protected readonly filteredEntries = computed(() => {
    const query = normalizeSearch(this.searchQuery());

    if (!query) {
      return this.entries();
    }

    return this.entries().filter((entry) =>
      normalizeSearch([
        entry.entryDate,
        entry.entryId,
        entry.journalCode,
        entry.voucherNumber,
        entry.label,
        entry.status
      ].filter(Boolean).join(' ')).includes(query)
    );
  });
  protected readonly hasMoreEntries = computed(() => {
    const paginationState = this.paginationState();

    return paginationState.hasMore ?? this.entriesQuery.data()?.hasMore ?? false;
  });
  protected readonly nextCursor = computed(() => {
    const paginationState = this.paginationState();

    return paginationState.nextCursor ?? this.entriesQuery.data()?.nextCursor;
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.selectedYear.set(`${this.fiscalYearContext.activeYear() ?? params.get('year') ?? this.currentYear}`);
      this.selectedJournalCode.set(params.get('journalCode'));
      this.resetListPagination();
    });

    effect(() => {
      const activeYear = this.fiscalYearContext.activeYear();

      if (activeYear) {
        const nextYear = `${activeYear}`;
        const yearChanged = this.selectedYear() !== nextYear;

        if (yearChanged) {
          this.selectedYear.set(nextYear);
        }

        if (yearChanged) {
          this.resetListPagination();
        }
      }
    });
  }

  protected updateSelectedYear(event: Event): void {
    this.selectedYear.set((event.target as HTMLInputElement).value);
    this.resetListPagination();
  }

  protected updateSelectedMonth(value: string): void {
    this.selectedMonth.set(value || null);
    this.resetListPagination();
  }

  protected updateSelectedJournal(value: string): void {
    this.selectedJournalCode.set(value || null);
    if (!value) {
      this.selectedMonth.set(null);
    }
    this.resetListPagination();
  }

  protected updateSelectedStatus(value: EntryStatusFilter): void {
    this.selectedStatus.set(value);
    this.resetListPagination();
  }

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.searchQuery.set('');
    this.selectedJournalCode.set(null);
    this.selectedMonth.set(null);
    this.selectedStatus.set('ALL');
    this.selectedYear.set(`${this.fiscalYearContext.activeYear() ?? this.currentYear}`);
    this.resetListPagination();
  }

  protected isColumnVisible(columnId: EntryTableColumnId): boolean {
    return this.visibleColumnIds().includes(columnId);
  }

  protected openTablePreferences(): void {
    const dialogRef = this.dialog.open(LiassTablePreferencesDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        columns: ENTRY_TABLE_COLUMNS,
        tableId: ACCOUNTING_ENTRIES_TABLE_ID,
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
          ACCOUNTING_ENTRIES_TABLE_ID,
          ENTRY_TABLE_COLUMNS,
          result.visibleColumnIds
        )
      );
    });
  }

  protected async retryInitialLoad(): Promise<void> {
    this.resetListPagination();
    await this.entriesQuery.refetch();
  }

  protected async loadMoreEntries(): Promise<void> {
    const cursor = this.nextCursor();

    if (!cursor || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.loadMoreError.set(false);

    try {
      const result = await this.accountingApi.listEntries({
        year: this.selectedYear(),
        journalCode: this.selectedJournalCode() || undefined,
        month: this.selectedJournalCode() ? this.selectedMonth() || undefined : undefined,
        status: this.selectedStatusParam(),
        limit: 100,
        cursor
      });

      this.extraEntries.update((entries) => [...entries, ...result.items]);
      this.paginationState.set({
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
      });
    } catch {
      this.loadMoreError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected async openNewEntryPage(): Promise<void> {
    await this.router.navigate(['/accounting/entries/new']);
  }

  protected viewEntryFoundationNotice(): void {
    // Entry detail is intentionally deferred to the next entries slice.
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR').format(amount);
  }

  protected entryStatusTone(status: EntrySummaryDto['status']): 'danger' | 'success' | 'warning' {
    if (status === 'POSTED') {
      return 'success';
    }

    if (status === 'DRAFT') {
      return 'warning';
    }

    return 'danger';
  }

  private resetListPagination(): void {
    this.extraEntries.set([]);
    this.paginationState.set({});
    this.loadMoreError.set(false);
  }

  private selectedStatusParam(): EntrySummaryDto['status'] | undefined {
    const status = this.selectedStatus();

    return status === 'ALL' ? undefined : status;
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
