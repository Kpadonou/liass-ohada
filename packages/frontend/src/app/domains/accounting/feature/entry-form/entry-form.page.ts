import { Component, computed, effect, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
    label: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]]
  });

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
  protected readonly useSearchableJournalSelect = computed(() => this.journals().length > 10);
  protected readonly minEntryDate = computed(() => this.activeFiscalYear()?.startDate ?? null);
  protected readonly maxEntryDate = computed(() => this.activeFiscalYear()?.endDate ?? null);
  protected readonly totalDebit = 0;
  protected readonly totalCredit = 0;
  protected readonly difference = 0;

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
    });
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
}
