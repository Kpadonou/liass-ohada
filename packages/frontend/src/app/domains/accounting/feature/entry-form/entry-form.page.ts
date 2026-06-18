import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
  type FormGroup
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import {
  LiassSearchableSelectComponent,
  type LiassSearchableSelectOption
} from '../../../../shared/ui/searchable-select/searchable-select.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

type EntryLineForm = FormGroup<{
  accountId: FormControl<string>;
  credit: FormControl<number>;
  debit: FormControl<number>;
  label: FormControl<string>;
  lineId: FormControl<string>;
  thirdPartyId: FormControl<string>;
}>;

@Component({
  selector: 'liass-entry-form-page',
  host: {
    class: 'block'
  },
  imports: [
    FiscalYearRequiredComponent,
    LiassButtonComponent,
    LiassCardComponent,
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
  templateUrl: './entry-form.page.html'
})
export class EntryFormPage {
  private readonly accountingQueries = inject(AccountingQueries);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly entryId = this.route.snapshot.paramMap.get('entryId');
  protected readonly isEditMode = !!this.entryId;
  protected readonly activeFiscalYear = computed(() => this.fiscalYearContext.activeFiscalYear());
  protected readonly pageTitleKey = this.isEditMode
    ? 'ACCOUNTING.ENTRIES.FORM.EDIT_TITLE'
    : 'ACCOUNTING.ENTRIES.FORM.NEW_TITLE';
  protected readonly pageSubtitleKey = this.isEditMode
    ? 'ACCOUNTING.ENTRIES.FORM.EDIT_SUBTITLE'
    : 'ACCOUNTING.ENTRIES.FORM.NEW_SUBTITLE';

  protected readonly form = this.formBuilder.nonNullable.group({
    entryDate: [this.initialEntryDate(), [Validators.required]],
    journalCode: ['', [Validators.required]],
    voucherNumber: [''],
    label: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
    lines: this.formBuilder.array<EntryLineForm>(
      [this.createLine(), this.createLine()],
      [Validators.minLength(2)]
    )
  });
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue()
  });

  protected readonly accountsQuery = injectQuery(() => ({
    ...this.accountingQueries.listAccounts({ limit: 200 }),
    enabled: this.fiscalYearContext.hasActiveFiscalYear()
  }));
  protected readonly journalsQuery = injectQuery(() => ({
    ...this.accountingQueries.listJournals(),
    enabled: this.fiscalYearContext.hasActiveFiscalYear()
  }));
  protected readonly entryQuery = injectQuery(() =>
    this.accountingQueries.entryDetail(
      this.entryId ?? '',
      this.fiscalYearContext.activeYear(),
      this.isEditMode && this.fiscalYearContext.hasActiveFiscalYear()
    )
  );

  protected readonly journals = computed(() => {
    const activeYear = this.fiscalYearContext.activeYear();

    return (this.journalsQuery.data() ?? []).filter((journal) => journal.year === activeYear);
  });
  protected readonly journalOptions = computed<LiassSearchableSelectOption[]>(() =>
    this.journals().map((journal) => ({
      label: `${journal.journalCode} - ${journal.journalName}`,
      value: journal.journalCode
    }))
  );
  protected readonly accountOptions = computed<LiassSearchableSelectOption[]>(() =>
    (this.accountsQuery.data()?.items ?? []).map((account) => ({
      label: `${account.accountId} - ${account.accountName}`,
      value: account.accountId
    }))
  );
  protected readonly useSearchableJournalSelect = computed(() => this.journals().length > 10);
  protected readonly minEntryDate = computed(() => this.activeFiscalYear()?.startDate ?? null);
  protected readonly maxEntryDate = computed(() => this.activeFiscalYear()?.endDate ?? null);
  protected readonly totalDebit = computed(() =>
    this.sumLineAmounts(this.formValue().lines ?? [], 'debit')
  );
  protected readonly totalCredit = computed(() =>
    this.sumLineAmounts(this.formValue().lines ?? [], 'credit')
  );
  protected readonly difference = computed(() => this.totalDebit() - this.totalCredit());
  protected readonly isBalanced = computed(
    () =>
      this.lines.length >= 2 &&
      this.totalDebit() > 0 &&
      this.totalDebit() === this.totalCredit() &&
      this.lines.valid
  );
  protected readonly publishAvailable = false;

  constructor() {
    effect(() => {
      const fiscalYear = this.activeFiscalYear();

      if (!fiscalYear || this.isEditMode) {
        return;
      }

      const entryDate = this.form.controls.entryDate.value;
      if (entryDate < fiscalYear.startDate || entryDate > fiscalYear.endDate) {
        this.form.controls.entryDate.setValue(fiscalYear.startDate);
      }
    });

    effect(() => {
      const entry = this.entryQuery.data();

      if (!entry || entry.status !== 'DRAFT') {
        return;
      }

      this.form.patchValue({
        entryDate: entry.entryDate,
        journalCode: entry.journalCode,
        voucherNumber: entry.voucherNumber ?? '',
        label: entry.label ?? ''
      });
      this.lines.clear();
      for (const line of entry.lines) {
        this.lines.push(
          this.createLine({
            accountId: line.accountId,
            credit: line.credit,
            debit: line.debit,
            label: line.label ?? line.description ?? '',
            lineId: line.lineId,
            thirdPartyId: line.thirdPartyId ?? ''
          })
        );
      }

      while (this.lines.length < 2) {
        this.lines.push(this.createLine());
      }
    });
  }

  protected get lines(): FormArray<EntryLineForm> {
    return this.form.controls.lines;
  }

  protected addLine(): void {
    this.lines.push(this.createLine());
  }

  protected removeLine(index: number): void {
    if (this.lines.length <= 2) {
      return;
    }

    this.lines.removeAt(index);
    this.lines.markAsDirty();
  }

  protected lineHasAmountConflict(line: EntryLineForm): boolean {
    return line.hasError('bothDebitAndCredit');
  }

  protected lineHasNoAmount(line: EntryLineForm): boolean {
    return line.hasError('amountRequired');
  }

  protected formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0
    }).format(amount);
  }

  protected draftModel() {
    const raw = this.form.getRawValue();

    return {
      year: this.fiscalYearContext.activeYear(),
      entryDate: raw.entryDate,
      journalCode: raw.journalCode,
      voucherNumber: raw.voucherNumber || undefined,
      entryType: 'STANDARD' as const,
      label: raw.label,
      lines: raw.lines.map((line) => ({
        lineId: line.lineId || undefined,
        accountId: line.accountId,
        thirdPartyId: line.thirdPartyId || undefined,
        label: line.label || undefined,
        debit: Number(line.debit),
        credit: Number(line.credit)
      }))
    };
  }

  protected async goBack(): Promise<void> {
    await this.router.navigate(['/accounting/entries']);
  }

  private initialEntryDate(): string {
    const fiscalYear = this.fiscalYearContext.activeFiscalYear();
    const today = new Date().toISOString().slice(0, 10);

    if (!fiscalYear) {
      return today;
    }

    if (today < fiscalYear.startDate || today > fiscalYear.endDate) {
      return fiscalYear.startDate;
    }

    return today;
  }

  private createLine(
    value: Partial<{
      accountId: string;
      credit: number;
      debit: number;
      label: string;
      lineId: string;
      thirdPartyId: string;
    }> = {}
  ): EntryLineForm {
    return this.formBuilder.nonNullable.group(
      {
        lineId: [value.lineId ?? ''],
        accountId: [
          value.accountId ?? '',
          [Validators.required, Validators.pattern(/^\d{8}$/)]
        ],
        label: [value.label ?? '', [Validators.maxLength(255)]],
        thirdPartyId: [value.thirdPartyId ?? ''],
        debit: [
          value.debit ?? 0,
          [Validators.required, Validators.min(0), Validators.pattern(/^\d+$/)]
        ],
        credit: [
          value.credit ?? 0,
          [Validators.required, Validators.min(0), Validators.pattern(/^\d+$/)]
        ]
      },
      { validators: [entryLineAmountValidator()] }
    ) as EntryLineForm;
  }

  private sumLineAmounts(
    lines: readonly Partial<{ credit: number; debit: number }>[],
    side: 'credit' | 'debit'
  ): number {
    return lines.reduce((total, line) => total + Number(line[side] || 0), 0);
  }
}

function entryLineAmountValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const debit = Number(control.get('debit')?.value || 0);
    const credit = Number(control.get('credit')?.value || 0);

    if (debit > 0 && credit > 0) {
      return { bothDebitAndCredit: true };
    }

    if (debit === 0 && credit === 0) {
      return { amountRequired: true };
    }

    return null;
  };
}
