import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { debounceTime } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AccountingApi, type JournalBookParams } from '../../data-access/accounting.api';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';
import {
  JournalBookExportService,
  type JournalBookExportLabels,
  type JournalBookExportMetadata
} from '../../utils/journal-book-export';
import { filesystemSafeName } from '../../utils/trial-balance-export';

const PAGE_SIZE = 25;

@Component({
  selector: 'liass-journal-book-page',
  imports: [
    FiscalYearRequiredComponent, LiassButtonComponent, LiassPageHeaderComponent,
    LiassSkeletonComponent, LiassStatusChipComponent, MatFormFieldModule,
    MatIconModule, MatInputModule, MatSelectModule, MatTooltipModule,
    ReactiveFormsModule, TranslocoModule
  ],
  templateUrl: './journal-book.page.html'
})
export class JournalBookPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly authStore = inject(AuthStore);
  private readonly exportService = inject(JournalBookExportService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<string[]>([]);
  protected readonly exporting = signal(false);
  protected readonly filters = signal<JournalBookParams>(this.defaultFilters());
  protected readonly form = new FormGroup({
    year: new FormControl(this.filters().year, { nonNullable: true }),
    startDate: new FormControl(this.filters().startDate, { nonNullable: true }),
    endDate: new FormControl(this.filters().endDate, { nonNullable: true }),
    journalCode: new FormControl('', { nonNullable: true }),
    entryNumber: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true }),
    accountPrefix: new FormControl('', { nonNullable: true })
  });
  protected readonly journalsQuery = injectQuery(() => this.accountingQueries.listJournals());
  protected readonly journals = computed(() => this.journalsQuery.data() ?? []);
  protected readonly validationKey = computed(() => {
    const filters = this.filters();
    const fiscalYear = this.fiscalYearContext.fiscalYears()
      .find((year) => String(year.year) === filters.year);
    if (!fiscalYear || !filters.startDate || !filters.endDate) {
      return 'ACCOUNTING.JOURNAL_BOOK.VALIDATION.REQUIRED';
    }
    if (filters.startDate > filters.endDate) {
      return 'ACCOUNTING.JOURNAL_BOOK.VALIDATION.DATE_ORDER';
    }
    if (filters.startDate < fiscalYear.startDate || filters.endDate > fiscalYear.endDate) {
      return 'ACCOUNTING.JOURNAL_BOOK.VALIDATION.OUTSIDE_YEAR';
    }
    if (filters.accountPrefix && !/^\d{1,8}$/.test(filters.accountPrefix)) {
      return 'ACCOUNTING.JOURNAL_BOOK.VALIDATION.ACCOUNT_PREFIX';
    }
    return null;
  });
  protected readonly filtersValid = computed(() => !this.validationKey());
  protected readonly query = injectQuery(() =>
    this.accountingQueries.journalBook(
      { ...this.filters(), limit: PAGE_SIZE, cursor: this.cursor() },
      this.filtersValid()
    )
  );
  protected readonly result = computed(() => this.query.data());
  protected readonly errorMessage = computed(() => safeMessageFromError(this.query.error()));
  protected readonly exportsDisabled = computed(() =>
    !this.filtersValid() || this.query.isPending() || this.exporting() ||
    !this.result()?.items.length
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(), debounceTime(275)).subscribe(() => {
      this.filters.set(this.normalizedFilters());
      this.resetPagination();
    });
    effect(() => {
      const fiscalYear = this.fiscalYearContext.activeFiscalYear();
      if (fiscalYear && this.form.controls.year.value !== String(fiscalYear.year)) {
        this.applyFiscalYear(String(fiscalYear.year));
      }
    });
  }

  protected yearChanged(year: string): void { this.applyFiscalYear(year); }
  protected resetFilters(): void {
    const year = this.fiscalYearContext.activeFiscalYear();
    if (!year) return;
    this.form.reset({
      year: String(year.year), startDate: year.startDate, endDate: this.defaultEndDate(year.endDate),
      journalCode: '', entryNumber: '', reference: '', accountPrefix: ''
    });
  }
  protected nextPage(): void {
    const next = this.result()?.nextCursor;
    if (!next) return;
    this.cursorHistory.update((history) => [...history, this.cursor() ?? '']);
    this.cursor.set(next);
  }
  protected previousPage(): void {
    const history = [...this.cursorHistory()];
    const previous = history.pop();
    this.cursorHistory.set(history);
    this.cursor.set(previous || undefined);
  }
  protected viewDetail(entryId: string): void {
    void this.router.navigate(['/accounting/entries', entryId], {
      queryParams: { year: this.filters().year, returnTo: '/accounting/journal-book' }
    });
  }
  protected formatAmount(amount: number): string {
    return amount ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount) : '—';
  }
  protected async retry(): Promise<void> { await this.query.refetch(); }
  protected async exportExcel(): Promise<void> { await this.export('excel'); }
  protected async exportPdf(): Promise<void> { await this.export('pdf'); }

  private async export(kind: 'excel' | 'pdf'): Promise<void> {
    if (this.exportsDisabled()) return;
    this.exporting.set(true);
    try {
      const complete = await this.accountingApi.getCompleteJournalBook(this.filters());
      await this.exportService[kind](
        complete.items, complete.totals, this.exportMetadata(complete.totals.isBalanced),
        this.exportLabels()
      );
      this.notification.success(this.transloco.translate(
        `ACCOUNTING.JOURNAL_BOOK.EXPORT.SUCCESS_${kind.toUpperCase()}`
      ));
    } catch {
      this.notification.error(this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.EXPORT.FAILED'));
    } finally {
      this.exporting.set(false);
    }
  }

  private defaultFilters(): JournalBookParams {
    const year = this.fiscalYearContext.activeFiscalYear();
    return {
      year: year ? String(year.year) : '',
      startDate: year?.startDate ?? '',
      endDate: year ? this.defaultEndDate(year.endDate) : ''
    };
  }
  private normalizedFilters(): JournalBookParams {
    const raw = this.form.getRawValue();
    return {
      year: raw.year, startDate: raw.startDate, endDate: raw.endDate,
      ...(raw.journalCode ? { journalCode: raw.journalCode } : {}),
      ...(raw.entryNumber.trim() ? { entryNumber: raw.entryNumber.trim() } : {}),
      ...(raw.reference.trim() ? { reference: raw.reference.trim() } : {}),
      ...(raw.accountPrefix.trim() ? { accountPrefix: raw.accountPrefix.trim() } : {})
    };
  }
  private applyFiscalYear(year: string): void {
    const fiscalYear = this.fiscalYearContext.fiscalYears()
      .find((candidate) => String(candidate.year) === year);
    if (fiscalYear) {
      this.form.patchValue({
        year,
        startDate: fiscalYear.startDate,
        endDate: this.defaultEndDate(fiscalYear.endDate)
      });
    }
  }
  private defaultEndDate(fiscalYearEndDate: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return today < fiscalYearEndDate ? today : fiscalYearEndDate;
  }
  private resetPagination(): void { this.cursor.set(undefined); this.cursorHistory.set([]); }
  private exportMetadata(isBalanced: boolean): JournalBookExportMetadata {
    const fiscalYear = this.fiscalYearContext.fiscalYears()
      .find((candidate) => String(candidate.year) === this.filters().year);
    const organizationName = this.authStore.activeDossierDisplayName() ||
      this.authStore.activeWorkspaceDisplayName() || 'Dossier comptable';
    const journal = this.filters().journalCode
      ? this.journals().find((item) => item.journalCode === this.filters().journalCode)
      : undefined;
    const fileBase = `livre-journal-${filesystemSafeName(organizationName)}-${this.filters().startDate}-au-${this.filters().endDate}`;
    return {
      organizationName,
      title: this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.TITLE'),
      framework: `${this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.EXPORT.FRAMEWORK')}: ${fiscalYear?.accountingFramework ?? '—'}`,
      fiscalYear: `${this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.FILTERS.YEAR')}: ${this.filters().year}`,
      period: `${this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.EXPORT.PERIOD')}: ${this.filters().startDate} – ${this.filters().endDate}`,
      journal: `${this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.FILTERS.JOURNAL')}: ${journal ? `${journal.journalCode} — ${journal.journalName}` : this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.FILTERS.ALL_JOURNALS')}`,
      currency: this.transloco.translate('ACCOUNTING.JOURNAL_BOOK.CURRENCY'),
      generatedAt: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
      filters: [this.filters().entryNumber, this.filters().reference, this.filters().accountPrefix].filter(Boolean).join(' · ') || '—',
      status: this.transloco.translate(isBalanced ? 'ACCOUNTING.JOURNAL_BOOK.STATUS.BALANCED' : 'ACCOUNTING.JOURNAL_BOOK.STATUS.UNBALANCED'),
      fileName: fileBase
    };
  }
  private exportLabels(): JournalBookExportLabels {
    const key = (name: string) => this.transloco.translate(`ACCOUNTING.JOURNAL_BOOK.TABLE.${name}`);
    return {
      date: key('DATE'), journal: key('JOURNAL'), entryNumber: key('ENTRY_NUMBER'),
      reference: key('REFERENCE'), accountCode: key('ACCOUNT'), accountLabel: key('ACCOUNT_LABEL'),
      label: key('LABEL'), thirdParty: key('THIRD_PARTY'), debit: key('DEBIT'),
      credit: key('CREDIT'), totals: key('TOTALS')
    };
  }
}
