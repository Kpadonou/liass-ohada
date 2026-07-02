import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { type FiscalYearDto, type SimplifiedReportDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import {
  LiassStatusChipComponent,
  type LiassStatusTone
} from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { type SimplifiedReportParams } from '../../data-access/accounting.api';

type SimplifiedReportFilters = SimplifiedReportParams;
type IncomeAccountRows = NonNullable<SimplifiedReportDto['income']['revenueAccounts']>;

@Component({
  selector: 'liass-simplified-reporting-page',
  imports: [
    LiassButtonComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
    RouterLink,
    TranslocoModule
  ],
  templateUrl: './simplified-reporting.page.html'
})
export class SimplifiedReportingPage {
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);

  private readonly initialFilters = this.defaultFilters();
  private readonly formRevision = signal(0);
  protected readonly appliedFilters = signal<SimplifiedReportFilters | null>(this.initialFilters);

  protected readonly filterForm = this.formBuilder.nonNullable.group({
    fiscalYear: [this.initialFilters?.fiscalYear ?? '', [Validators.required, Validators.pattern(/^\d{4}$/)]],
    startDate: [this.initialFilters?.startDate ?? ''],
    endDate: [this.initialFilters?.endDate ?? ''],
    includeAuxiliary: [this.initialFilters?.includeAuxiliary ?? true],
    includeClosingChecks: [this.initialFilters?.includeClosingChecks ?? true]
  });

  protected readonly selectedFiscalYear = computed(() =>
    (this.formRevision(),
    this.fiscalYearContext
      .fiscalYears()
      .find((fiscalYear) => String(fiscalYear.year) === this.filterForm.controls.fiscalYear.value))
  );

  protected readonly filterError = computed(() => {
    this.formRevision();
    const raw = this.filterForm.getRawValue();

    if (!this.fiscalYearContext.hasActiveFiscalYear()) {
      return 'ACCOUNTING.SIMPLIFIED_REPORTING.STATES.NO_ACTIVE_FISCAL_YEAR';
    }

    if (!raw.fiscalYear || !raw.startDate || !raw.endDate) {
      return 'ACCOUNTING.SIMPLIFIED_REPORTING.VALIDATION.PERIOD_REQUIRED';
    }

    if (raw.startDate > raw.endDate) {
      return 'ACCOUNTING.SIMPLIFIED_REPORTING.VALIDATION.DATE_RANGE';
    }

    const fiscalYear = this.selectedFiscalYear();
    if (
      fiscalYear &&
      (raw.startDate < fiscalYear.startDate || raw.endDate > fiscalYear.endDate)
    ) {
      return 'ACCOUNTING.SIMPLIFIED_REPORTING.VALIDATION.OUTSIDE_FISCAL_YEAR';
    }

    return null;
  });

  protected readonly filtersValid = computed(
    () =>
      !this.filterError() &&
      !!this.appliedFilters() &&
      !!this.fiscalYearContext.tenantScope()
  );

  protected readonly reportQuery = injectQuery(() =>
    this.accountingQueries.simplifiedReport(
      this.appliedFilters() ?? {
        fiscalYear: '',
        includeAuxiliary: true,
        includeClosingChecks: true
      },
      this.filtersValid()
    )
  );

  protected readonly report = computed(() => this.reportQuery.data());
  protected readonly errorMessage = computed(() => safeMessageFromError(this.reportQuery.error()));
  protected readonly trialBalanceDifference = computed(() => {
    const trialBalance = this.report()?.trialBalance;
    return trialBalance ? Math.abs(trialBalance.totalDebit - trialBalance.totalCredit) : 0;
  });
  protected readonly noData = computed(() => {
    const report = this.report();

    return !!report && this.isReportEmpty(report);
  });

  constructor() {
    this.filterForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
    });

    effect(() => {
      const fiscalYear = this.fiscalYearContext.activeFiscalYear();

      if (!fiscalYear) {
        this.appliedFilters.set(null);
        this.filterForm.reset({
          fiscalYear: '',
          startDate: '',
          endDate: '',
          includeAuxiliary: true,
          includeClosingChecks: true
        });
        return;
      }

      const defaults = this.filtersForFiscalYear(fiscalYear);
      if (this.filterForm.controls.fiscalYear.value === defaults.fiscalYear) {
        return;
      }

      this.filterForm.reset(defaults);
      this.appliedFilters.set(defaults);
    });
  }

  protected fiscalYearChanged(year: string): void {
    const fiscalYear = this.fiscalYearContext
      .fiscalYears()
      .find((candidate) => String(candidate.year) === year);

    if (!fiscalYear) {
      return;
    }

    this.filterForm.patchValue(this.filtersForFiscalYear(fiscalYear));
  }

  protected applyFilters(): void {
    if (this.filterError() || this.filterForm.invalid) {
      this.filterForm.markAllAsTouched();
      return;
    }

    const nextFilters = this.normalizedFormFilters();
    const currentFilters = this.appliedFilters();

    if (JSON.stringify(nextFilters) === JSON.stringify(currentFilters)) {
      void this.reportQuery.refetch();
      return;
    }

    this.appliedFilters.set(nextFilters);
  }

  protected retry(): void {
    void this.reportQuery.refetch();
  }

  protected formatAmount(amount: number | undefined, explicitZero = true): string {
    const value = amount ?? 0;

    if (value === 0 && !explicitZero) {
      return '—';
    }

    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value);
  }

  protected formatDate(value: string | undefined): string {
    if (!value) {
      return '—';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      ...(value.includes('T') ? { timeStyle: 'short' as const } : {})
    }).format(date);
  }

  protected resultLabelKey(netResult: number): string {
    return netResult >= 0
      ? 'ACCOUNTING.SIMPLIFIED_REPORTING.INCOME.BENEFIT'
      : 'ACCOUNTING.SIMPLIFIED_REPORTING.INCOME.LOSS';
  }

  protected resultTone(netResult: number): LiassStatusTone {
    return netResult >= 0 ? 'success' : 'warning';
  }

  protected trialBalanceStatusKey(isBalanced: boolean): string {
    return isBalanced
      ? 'ACCOUNTING.SIMPLIFIED_REPORTING.TRIAL_BALANCE.BALANCED'
      : 'ACCOUNTING.SIMPLIFIED_REPORTING.TRIAL_BALANCE.UNBALANCED';
  }

  protected trialBalanceStatusTone(isBalanced: boolean): LiassStatusTone {
    return isBalanced ? 'success' : 'danger';
  }

  protected closingReadinessStatusKey(canClose: boolean): string {
    return canClose
      ? 'ACCOUNTING.SIMPLIFIED_REPORTING.CLOSING.READY'
      : 'ACCOUNTING.SIMPLIFIED_REPORTING.CLOSING.NEEDS_REVIEW';
  }

  protected closingReadinessTone(canClose: boolean): LiassStatusTone {
    return canClose ? 'success' : 'warning';
  }

  protected hasAccountRows(rows: IncomeAccountRows | undefined): rows is IncomeAccountRows {
    return Array.isArray(rows) && rows.length > 0;
  }

  private defaultFilters(): SimplifiedReportFilters | null {
    const fiscalYear = this.fiscalYearContext.activeFiscalYear();
    return fiscalYear ? this.filtersForFiscalYear(fiscalYear) : null;
  }

  private filtersForFiscalYear(fiscalYear: FiscalYearDto): SimplifiedReportFilters {
    return {
      fiscalYear: String(fiscalYear.year),
      startDate: fiscalYear.startDate,
      endDate: fiscalYear.endDate,
      includeAuxiliary: true,
      includeClosingChecks: true
    };
  }

  private normalizedFormFilters(): SimplifiedReportFilters {
    const raw = this.filterForm.getRawValue();

    return {
      fiscalYear: raw.fiscalYear,
      ...(raw.startDate ? { startDate: raw.startDate } : {}),
      ...(raw.endDate ? { endDate: raw.endDate } : {}),
      includeAuxiliary: raw.includeAuxiliary,
      includeClosingChecks: raw.includeClosingChecks
    };
  }

  private isReportEmpty(report: SimplifiedReportDto): boolean {
    const trialBalance = report.trialBalance;
    const income = report.income;
    const auxiliary = report.auxiliary;
    const closingReadiness = report.closingReadiness;
    const hasAuxiliaryData = [
      auxiliary?.customers,
      auxiliary?.suppliers
    ].some(
      (exposure) =>
        !!exposure &&
        (exposure.totalDebit > 0 ||
          exposure.totalCredit > 0 ||
          exposure.totalBalanceDebit > 0 ||
          exposure.totalBalanceCredit > 0 ||
          (exposure.unletteredAmount ?? 0) > 0 ||
          (exposure.thirdPartyCount ?? 0) > 0)
    );

    return (
      trialBalance.totalDebit === 0 &&
      trialBalance.totalCredit === 0 &&
      (trialBalance.accountCount ?? 0) === 0 &&
      (trialBalance.movementCount ?? 0) === 0 &&
      income.totalRevenue === 0 &&
      income.totalExpense === 0 &&
      income.netResult === 0 &&
      !this.hasAccountRows(income.revenueAccounts) &&
      !this.hasAccountRows(income.expenseAccounts) &&
      !hasAuxiliaryData &&
      !closingReadiness
    );
  }
}
