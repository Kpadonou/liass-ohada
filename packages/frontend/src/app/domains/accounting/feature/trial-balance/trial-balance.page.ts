import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { type TrialBalanceDto } from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { AuthStore } from '../../../identity/data-access/auth.store';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { type TrialBalanceParams } from '../../data-access/accounting.api';
import {
  filesystemSafeName,
  TrialBalanceExportService,
  type TrialBalanceExportLabels,
  type TrialBalanceExportMetadata
} from '../../utils/trial-balance-export';
import { FiscalYearRequiredComponent } from '../../ui/fiscal-year-required/fiscal-year-required.component';

type TrialBalanceFilters = TrialBalanceParams;

@Component({
  selector: 'liass-trial-balance-page',
  imports: [
    FiscalYearRequiredComponent,
    LiassButtonComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './trial-balance.page.html'
})
export class TrialBalancePage {
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly authStore = inject(AuthStore);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly trialBalanceExport = inject(TrialBalanceExportService);
  protected readonly fiscalYearContext = inject(AccountingFiscalYearContextService);

  protected readonly accountClasses = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly filters = signal<TrialBalanceFilters>(this.defaultFilters());
  protected readonly exporting = signal(false);
  protected readonly filterForm = new FormGroup({
    year: new FormControl(this.filters().year, { nonNullable: true }),
    startDate: new FormControl(this.filters().startDate, { nonNullable: true }),
    endDate: new FormControl(this.filters().endDate, { nonNullable: true }),
    accountPrefix: new FormControl('', { nonNullable: true }),
    accountFrom: new FormControl('', { nonNullable: true }),
    accountTo: new FormControl('', { nonNullable: true }),
    accountClass: new FormControl<number | null>(null),
    hideZeroMovement: new FormControl(false, { nonNullable: true })
  });

  protected readonly filterError = computed(() => {
    const filters = this.filters();
    const fiscalYear = this.fiscalYearContext
      .fiscalYears()
      .find((candidate) => String(candidate.year) === filters.year);

    if (!fiscalYear || !filters.startDate || !filters.endDate) {
      return 'ACCOUNTING.TRIAL_BALANCE.VALIDATION.PERIOD_REQUIRED';
    }

    if (filters.startDate > filters.endDate) {
      return 'ACCOUNTING.TRIAL_BALANCE.VALIDATION.DATE_ORDER';
    }

    if (
      filters.startDate < fiscalYear.startDate ||
      filters.endDate > fiscalYear.endDate
    ) {
      return 'ACCOUNTING.TRIAL_BALANCE.VALIDATION.OUTSIDE_FISCAL_YEAR';
    }

    if (
      filters.accountFrom &&
      filters.accountTo &&
      filters.accountFrom.padEnd(8, '0') > filters.accountTo.padEnd(8, '9')
    ) {
      return 'ACCOUNTING.TRIAL_BALANCE.VALIDATION.ACCOUNT_RANGE';
    }

    return null;
  });
  protected readonly filtersValid = computed(
    () => !this.filterError() && !!this.fiscalYearContext.tenantScope()
  );

  protected readonly trialBalanceQuery = injectQuery(() =>
    this.accountingQueries.trialBalance(this.filters(), this.filtersValid())
  );
  protected readonly trialBalance = computed(() => this.trialBalanceQuery.data());
  protected readonly errorMessage = computed(() =>
    safeMessageFromError(this.trialBalanceQuery.error())
  );
  protected readonly exportsDisabled = computed(
    () =>
      !this.filtersValid() ||
      this.trialBalanceQuery.isPending() ||
      this.exporting() ||
      !this.trialBalance()?.rows.length
  );

  constructor() {
    this.filterForm.valueChanges
      .pipe(
        takeUntilDestroyed(),
        debounceTime(275),
        map(() => JSON.stringify(this.normalizedFormFilters())),
        distinctUntilChanged()
      )
      .subscribe((serialized) => this.filters.set(JSON.parse(serialized)));

    effect(() => {
      const activeFiscalYear = this.fiscalYearContext.activeFiscalYear();
      if (!activeFiscalYear) {
        return;
      }

      const currentYear = this.filterForm.controls.year.value;
      if (currentYear === String(activeFiscalYear.year)) {
        return;
      }

      this.applyFiscalYear(String(activeFiscalYear.year));
    });
  }

  protected fiscalYearChanged(year: string): void {
    this.applyFiscalYear(year);
  }

  protected resetFilters(): void {
    const fiscalYear =
      this.selectedFiscalYear() ?? this.fiscalYearContext.activeFiscalYear();
    if (!fiscalYear) {
      return;
    }

    const defaults = this.filtersForFiscalYear(fiscalYear);
    this.filterForm.reset({
      ...defaults,
      accountPrefix: '',
      accountFrom: '',
      accountTo: '',
      accountClass: null,
      hideZeroMovement: false
    });
  }

  protected async retry(): Promise<void> {
    await this.trialBalanceQuery.refetch();
  }

  protected openGeneralLedger(accountCode: string): void {
    const filters = this.filters();
    void this.router.navigate(['/accounting/general-ledger'], {
      queryParams: {
        account: accountCode,
        year: filters.year,
        startDate: filters.startDate,
        endDate: filters.endDate
      }
    });
  }

  protected formatAmount(amount: number, explicitZero = false): string {
    if (amount === 0 && !explicitZero) {
      return '—';
    }

    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount);
  }

  protected async exportExcel(): Promise<void> {
    const report = this.trialBalance();
    if (!report || this.exportsDisabled()) {
      return;
    }

    this.exporting.set(true);
    try {
      await this.trialBalanceExport.excel(
        report,
        this.exportMetadata(report),
        this.exportLabels()
      );
      this.notification.success(
        this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.SUCCESS_EXCEL')
      );
    } catch {
      this.notification.error(
        this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.FAILED')
      );
    } finally {
      this.exporting.set(false);
    }
  }

  protected async exportPdf(): Promise<void> {
    const report = this.trialBalance();
    if (!report || this.exportsDisabled()) {
      return;
    }

    this.exporting.set(true);
    try {
      await this.trialBalanceExport.pdf(
        report,
        this.exportMetadata(report),
        this.exportLabels()
      );
      this.notification.success(
        this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.SUCCESS_PDF')
      );
    } catch {
      this.notification.error(
        this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.FAILED')
      );
    } finally {
      this.exporting.set(false);
    }
  }

  private defaultFilters(): TrialBalanceFilters {
    const fiscalYear = this.fiscalYearContext.activeFiscalYear();
    return fiscalYear
      ? this.filtersForFiscalYear(fiscalYear)
      : {
          year: '',
          startDate: '',
          endDate: '',
          hideZeroMovement: false
        };
  }

  private filtersForFiscalYear(
    fiscalYear: NonNullable<ReturnType<AccountingFiscalYearContextService['activeFiscalYear']>>
  ): TrialBalanceFilters {
    return {
      year: String(fiscalYear.year),
      startDate: fiscalYear.startDate,
      endDate: fiscalYear.endDate,
      hideZeroMovement: false
    };
  }

  private applyFiscalYear(year: string): void {
    const fiscalYear = this.fiscalYearContext
      .fiscalYears()
      .find((candidate) => String(candidate.year) === year);
    if (!fiscalYear) {
      return;
    }

    const defaults = this.filtersForFiscalYear(fiscalYear);
    this.filterForm.patchValue({
      year: defaults.year,
      startDate: defaults.startDate,
      endDate: defaults.endDate
    });
  }

  private selectedFiscalYear() {
    return this.fiscalYearContext
      .fiscalYears()
      .find((candidate) => String(candidate.year) === this.filterForm.controls.year.value);
  }

  private normalizedFormFilters(): TrialBalanceFilters {
    const raw = this.filterForm.getRawValue();
    return {
      year: raw.year,
      startDate: raw.startDate,
      endDate: raw.endDate,
      ...(raw.accountPrefix.trim() ? { accountPrefix: raw.accountPrefix.trim() } : {}),
      ...(raw.accountFrom.trim() ? { accountFrom: raw.accountFrom.trim() } : {}),
      ...(raw.accountTo.trim() ? { accountTo: raw.accountTo.trim() } : {}),
      ...(raw.accountClass ? { accountClass: raw.accountClass } : {}),
      hideZeroMovement: raw.hideZeroMovement
    };
  }

  private exportMetadata(report: TrialBalanceDto): TrialBalanceExportMetadata {
    const fiscalYear = this.selectedFiscalYear();
    const organizationName =
      this.authStore.activeDossierDisplayName() ||
      this.authStore.activeWorkspaceDisplayName() ||
      this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.ORGANIZATION_FALLBACK') ||
      'Dossier comptable';
    const filterSummary = [
      this.filters().accountPrefix
        ? `${this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.FILTERS.ACCOUNT_PREFIX')}: ${this.filters().accountPrefix}`
        : null,
      this.filters().accountFrom || this.filters().accountTo
        ? `${this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.FILTERS.ACCOUNT_RANGE')}: ${this.filters().accountFrom ?? '…'} – ${this.filters().accountTo ?? '…'}`
        : null,
      this.filters().accountClass
        ? `${this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.FILTERS.CLASS')}: ${this.filters().accountClass}`
        : null
    ].filter((value): value is string => !!value);
    const balanced =
      report.totals.isMovementBalanced && report.totals.isClosingBalanced;

    return {
      organizationName,
      title: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.TITLE'),
      fiscalYearLabel: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.FILTERS.YEAR'),
      periodLabel: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.PERIOD'),
      frameworkLabel: `${this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.FRAMEWORK')}: ${fiscalYear?.accountingFramework ?? '—'}`,
      currencyLabel: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.CURRENCY'),
      generatedAtLabel: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.GENERATED_AT'),
      generatedAt: new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date()),
      filtersLabel: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.EXPORT.FILTERS'),
      filters: filterSummary.join(' · ') || undefined,
      controlLabel: balanced
        ? this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.CONTROL.BALANCED')
        : this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.CONTROL.UNBALANCED_WITH_DIFFERENCES', {
            movement: this.formatAmount(report.totals.movementDifference, true),
            closing: this.formatAmount(report.totals.closingDifference, true)
          }),
      fileName: `balance-generale-${filesystemSafeName(organizationName)}-${report.period.startDate}-au-${report.period.endDate}`
    };
  }

  private exportLabels(): TrialBalanceExportLabels {
    return {
      accountCode: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.ACCOUNT'),
      accountLabel: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.LABEL'),
      openingDebit: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.OPENING_DEBIT'),
      openingCredit: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.OPENING_CREDIT'),
      movementDebit: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.MOVEMENT_DEBIT'),
      movementCredit: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.MOVEMENT_CREDIT'),
      closingDebit: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.CLOSING_DEBIT'),
      closingCredit: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.CLOSING_CREDIT'),
      totals: this.transloco.translate('ACCOUNTING.TRIAL_BALANCE.TABLE.TOTALS')
    };
  }
}
