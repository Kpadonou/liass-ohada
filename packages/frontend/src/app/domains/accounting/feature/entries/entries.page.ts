import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { type EntrySummaryDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
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
import { AuthStore } from '../../../identity/data-access/auth.store';
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

interface EntryActionConfirmationDialogData {
  action: 'DELETE' | 'POST';
  entryLabel: string;
}

@Component({
  selector: 'liass-entry-action-confirmation-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <header class="px-6 pt-6">
      <div class="flex items-start gap-3">
        <span
          class="inline-flex size-10 items-center justify-center rounded-app-control"
          [class]="data.action === 'DELETE'
            ? 'bg-danger-50 text-danger-600 dark:bg-rose-950/35 dark:text-rose-300'
            : 'bg-warning-50 text-warning-600 dark:bg-amber-950/35 dark:text-amber-300'"
        >
          <mat-icon>{{ data.action === 'DELETE' ? 'delete_outline' : 'task_alt' }}</mat-icon>
        </span>
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            {{ 'ACCOUNTING.ENTRIES.CONFIRMATIONS.EYEBROW' | transloco }}
          </p>
          <h2 mat-dialog-title class="m-0 mt-2 p-0 text-2xl font-semibold text-slate-950 dark:text-white">
            {{
              (data.action === 'DELETE'
                ? 'ACCOUNTING.ENTRIES.CONFIRMATIONS.DELETE_TITLE'
                : 'ACCOUNTING.ENTRIES.CONFIRMATIONS.POST_TITLE'
              ) | transloco
            }}
          </h2>
        </div>
      </div>
    </header>

    <mat-dialog-content class="px-6 pb-0 pt-5">
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{
          (data.action === 'DELETE'
            ? 'ACCOUNTING.ENTRIES.CONFIRMATIONS.DELETE_MESSAGE'
            : 'ACCOUNTING.ENTRIES.CONFIRMATIONS.POST_MESSAGE'
          ) | transloco
        }}
      </p>
      <p class="mt-3 rounded-app-card border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
        {{ data.entryLabel }}
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="gap-3 px-6 pb-6 pt-5">
      <liass-button variant="outline" tone="neutral" (pressed)="cancel()">
        {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
      </liass-button>
      <liass-button
        variant="solid"
        [tone]="data.action === 'DELETE' ? 'danger' : 'warning'"
        [icon]="data.action === 'DELETE' ? 'delete_outline' : 'task_alt'"
        (pressed)="confirm()"
      >
        {{
          (data.action === 'DELETE'
            ? 'ACCOUNTING.ENTRIES.ACTIONS.DELETE_DRAFT'
            : 'ACCOUNTING.ENTRIES.ACTIONS.POST'
          ) | transloco
        }}
      </liass-button>
    </mat-dialog-actions>
  `
})
export class EntryActionConfirmationDialogComponent {
  protected readonly data = inject<EntryActionConfirmationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<
    MatDialogRef<EntryActionConfirmationDialogComponent, boolean>
  >(MatDialogRef);

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected confirm(): void {
    this.dialogRef.close(true);
  }
}

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
  protected readonly authStore = inject(AuthStore);
  protected readonly canWriteAccounting = () => !this.authStore.isAccountingReadOnly?.();
  private readonly accountingApi = inject(AccountingApi);
  private readonly dialog = inject(MatDialog);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

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
  protected readonly pendingEntryAction = signal<string | null>(null);
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

  protected async viewEntry(entryId: string): Promise<void> {
    await this.router.navigate(['/accounting/entries', entryId]);
  }

  protected async editEntry(entry: EntrySummaryDto): Promise<void> {
    if (entry.status !== 'DRAFT') {
      return;
    }

    await this.router.navigate(['/accounting/entries', entry.entryId, 'edit']);
  }

  protected confirmPostEntry(entry: EntrySummaryDto): void {
    if (entry.status !== 'DRAFT' || this.pendingEntryAction()) {
      return;
    }

    this.openEntryConfirmation('POST', entry);
  }

  protected confirmDeleteDraft(entry: EntrySummaryDto): void {
    if (entry.status !== 'DRAFT' || this.pendingEntryAction()) {
      return;
    }

    this.openEntryConfirmation('DELETE', entry);
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

  private openEntryConfirmation(
    action: EntryActionConfirmationDialogData['action'],
    entry: EntrySummaryDto
  ): void {
    this.dialog
      .open(EntryActionConfirmationDialogComponent, {
        autoFocus: 'first-tabbable',
        data: {
          action,
          entryLabel: entry.label || entry.voucherNumber || entry.entryId
        },
        disableClose: true,
        maxWidth: 'calc(100vw - 32px)',
        panelClass: 'liass-dialog-panel',
        restoreFocus: true,
        width: '540px'
      })
      .afterClosed()
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (confirmed) {
          void this.applyEntryAction(action, entry);
        }
      });
  }

  private async applyEntryAction(
    action: EntryActionConfirmationDialogData['action'],
    entry: EntrySummaryDto
  ): Promise<void> {
    const activeYear = this.fiscalYearContext.activeYear();

    if (entry.status !== 'DRAFT' || !activeYear || this.pendingEntryAction()) {
      if (!activeYear) {
        this.notification.error(
          this.transloco.translate('ACCOUNTING.ENTRIES.NOTIFICATIONS.FISCAL_YEAR_REQUIRED')
        );
      }
      return;
    }

    this.pendingEntryAction.set(`${action}:${entry.entryId}`);

    try {
      const result = action === 'POST'
        ? await this.accountingApi.postEntryDraft(entry.entryId, activeYear)
        : await this.accountingApi.deleteEntryDraft(entry.entryId, activeYear);
      const fallbackKey = action === 'POST'
        ? 'ACCOUNTING.ENTRIES.NOTIFICATIONS.POSTED'
        : 'ACCOUNTING.ENTRIES.NOTIFICATIONS.DRAFT_DELETED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));

      if (action === 'POST') {
        this.extraEntries.update((entries) =>
          entries.map((item) =>
            item.entryId === entry.entryId ? { ...item, status: 'POSTED' } : item
          )
        );
      } else {
        this.extraEntries.update((entries) =>
          entries.filter((item) => item.entryId !== entry.entryId)
        );
      }

      await this.queryClient.invalidateQueries({
        queryKey: this.accountingQueries.entriesRootQueryKey()
      });
    } catch (error) {
      const fallbackKey = action === 'POST'
        ? 'ACCOUNTING.ENTRIES.NOTIFICATIONS.POST_FAILED'
        : 'ACCOUNTING.ENTRIES.NOTIFICATIONS.DELETE_FAILED';

      this.notification.error(
        safeMessageFromError(error) ?? this.transloco.translate(fallbackKey)
      );
    } finally {
      this.pendingEntryAction.set(null);
    }
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
