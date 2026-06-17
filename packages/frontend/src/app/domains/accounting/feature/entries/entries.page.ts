import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type FormGroup
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute } from '@angular/router';
import { type CreateEntryRequest } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSearchableSelectComponent, type LiassSearchableSelectOption } from '../../../../shared/ui/searchable-select/searchable-select.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

type EntryLineForm = FormGroup;

@Component({
  selector: 'liass-entries-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    FiscalYearRequiredComponent,
    LiassPageHeaderComponent,
    LiassSearchableSelectComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './entries.page.html'
})
export class EntriesPage {
  private readonly accountingApi = inject(AccountingApi);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  protected readonly currentYear = `${new Date().getFullYear()}`;
  protected readonly selectedYear = signal(`${this.fiscalYearContext.activeYear() ?? this.currentYear}`);
  protected readonly selectedJournalCode = signal<string | null>(null);
  protected readonly selectedMonth = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly successEntryId = signal<string | null>(null);

  protected readonly accountsQuery = injectQuery(() => this.accountingQueries.listAccounts());
  protected readonly journalsQuery = injectQuery(() => this.accountingQueries.listJournals());
  protected readonly entriesQuery = injectQuery(() =>
    this.accountingQueries.listEntries({
      year: this.selectedYear(),
      journalCode: this.selectedJournalCode() || undefined,
      month: this.selectedJournalCode() ? this.selectedMonth() || undefined : undefined,
      limit: 100
    }, this.fiscalYearContext.hasActiveFiscalYear())
  );

  protected readonly accounts = computed(() => this.accountsQuery.data()?.items ?? []);
  protected readonly accountOptions = computed<LiassSearchableSelectOption[]>(() =>
    this.accounts().map((account) => ({
      value: account.accountId,
      label: `${account.accountId} - ${account.accountName}`
    }))
  );
  protected readonly journals = computed(() => this.journalsQuery.data() ?? []);
  protected readonly entries = computed(() => this.entriesQuery.data()?.items ?? []);

  protected readonly form = this.formBuilder.nonNullable.group({
    year: [new Date().getFullYear(), [Validators.required, Validators.min(2000), Validators.max(2100)]],
    entryDate: [new Date().toISOString().slice(0, 10), [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)]],
    journalCode: ['MISC', [Validators.required]],
    voucherNumber: [''],
    label: ['', [Validators.required, Validators.minLength(3)]],
    lines: this.formBuilder.array([this.createLine(), this.createLine()])
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.selectedYear.set(params.get('year') ?? `${this.fiscalYearContext.activeYear() ?? this.currentYear}`);
      this.selectedJournalCode.set(params.get('journalCode'));
    });

    effect(() => {
      const activeYear = this.fiscalYearContext.activeYear();

      if (activeYear) {
        this.selectedYear.set(`${activeYear}`);
        this.form.controls.year.setValue(activeYear);
      }
    });
  }

  protected get lines(): FormArray<EntryLineForm> {
    return this.form.controls.lines as FormArray<EntryLineForm>;
  }

  protected lineGroups(): EntryLineForm[] {
    return this.lines.controls;
  }

  protected addLine(): void {
    this.lines.push(this.createLine());
  }

  protected removeLine(index: number): void {
    if (this.lines.length > 2) {
      this.lines.removeAt(index);
    }
  }

  protected totalDebit(): number {
    return this.lines.controls.reduce((sum, line) => sum + Number(line.get('debit')?.value || 0), 0);
  }

  protected totalCredit(): number {
    return this.lines.controls.reduce((sum, line) => sum + Number(line.get('credit')?.value || 0), 0);
  }

  protected isBalanced(): boolean {
    return this.totalDebit() > 0 && this.totalDebit() === this.totalCredit();
  }

  protected updateSelectedYear(event: Event): void {
    this.selectedYear.set((event.target as HTMLInputElement).value);
  }

  protected updateSelectedMonth(value: string): void {
    this.selectedMonth.set(value || null);
  }

  protected updateSelectedJournal(value: string): void {
    this.selectedJournalCode.set(value || null);
    if (!value) {
      this.selectedMonth.set(null);
    }
  }

  protected async submit(): Promise<void> {
    if (!this.fiscalYearContext.hasActiveFiscalYear() || this.form.invalid || !this.isBalanced() || this.submitting()) {
      this.form.markAllAsTouched();
      this.errorKey.set(this.isBalanced() ? 'ACCOUNTING.ERRORS.POST_ENTRY_FAILED' : 'ACCOUNTING.ENTRIES.VALIDATION.UNBALANCED');
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);
    this.successEntryId.set(null);

    try {
      const raw = this.form.getRawValue();
      const payload: CreateEntryRequest = {
        year: Number(raw.year),
        accountingFramework: 'SYSCOHADA_REVISED',
        entryDate: raw.entryDate,
        journalCode: raw.journalCode,
        voucherNumber: raw.voucherNumber || undefined,
        entryType: 'STANDARD',
        label: raw.label,
        lines: raw.lines.map((line: any) => ({
          accountId: line.accountId,
          debit: Number(line.debit || 0),
          credit: Number(line.credit || 0),
          label: line.label || undefined
        }))
      };
      const entryId = await this.accountingApi.postEntry(payload);

      this.successEntryId.set(entryId);
      this.form.controls.label.reset('');
      this.form.controls.voucherNumber.reset('');
      this.lines.clear();
      this.lines.push(this.createLine());
      this.lines.push(this.createLine());
      void this.entriesQuery.refetch();
    } catch {
      this.errorKey.set('ACCOUNTING.ERRORS.POST_ENTRY_FAILED');
    } finally {
      this.submitting.set(false);
    }
  }

  protected accountLabel(accountId: string): string {
    const account = this.accounts().find((candidate) => candidate.accountId === accountId);
    return account ? `${account.accountId} - ${account.accountName}` : accountId;
  }

  private createLine(): EntryLineForm {
    return this.formBuilder.nonNullable.group({
      accountId: ['', [Validators.required, Validators.pattern(/^\d{8}$/)]],
      debit: [0, [Validators.required, Validators.min(0)]],
      credit: [0, [Validators.required, Validators.min(0)]],
      label: ['']
    }) as EntryLineForm;
  }
}
