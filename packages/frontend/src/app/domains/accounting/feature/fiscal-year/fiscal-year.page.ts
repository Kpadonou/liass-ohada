import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  type FiscalYearDto,
  type FiscalYearDetailsDto,
  type ClosingIssueDto
} from '@liass-ohada/shared/accounting';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingFiscalYearContextService } from '../../data-access/accounting-fiscal-year-context.service';
import { AccountingQueries } from '../../data-access/accounting-queries';
import { AuthStore } from '../../../identity/data-access/auth.store';

interface FiscalPeriod {
  month: string;
  labelKey: string;
}

interface CreateFiscalYearDialogData {
  year: number;
}

interface PeriodConfirmationDialogData {
  monthLabelKey: string;
}

interface FiscalYearCloseConfirmationDialogData {
  fiscalYear: FiscalYearDetailsDto;
  hasWarnings: boolean;
}

@Component({
  selector: 'liass-create-fiscal-year-dialog',
  imports: [
    LiassButtonComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  template: `
    <header class="px-6 pt-6">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">
        {{ 'ACCOUNTING.FISCAL_YEAR.CREATE_DIALOG.EYEBROW' | transloco }}
      </p>
      <h2 mat-dialog-title class="m-0 mt-2 p-0 text-2xl font-semibold text-slate-950 dark:text-white">
        {{ 'ACCOUNTING.FISCAL_YEAR.CREATE_DIALOG.TITLE' | transloco }}
      </h2>
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{ 'ACCOUNTING.FISCAL_YEAR.CREATE_DIALOG.DESCRIPTION' | transloco }}
      </p>
    </header>

    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="px-6 pb-0 pt-5">
        <div class="grid gap-4">
          <mat-form-field appearance="outline">
            <mat-label>{{ 'ACCOUNTING.FISCAL_YEAR.FIELDS.YEAR' | transloco }}</mat-label>
            <mat-icon matPrefix>event_available</mat-icon>
            <input matInput formControlName="year" inputmode="numeric" type="number" />
          </mat-form-field>
        </div>

        @if (errorMessage(); as message) {
          <div class="mt-4 flex items-start gap-3 rounded-app-card border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800 dark:border-red-950 dark:bg-red-950/35 dark:text-red-200" role="alert">
            <mat-icon class="mt-0.5">error</mat-icon>
            <p>{{ message }}</p>
          </div>
        } @else if (errorKey(); as key) {
          <div class="mt-4 flex items-start gap-3 rounded-app-card border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800 dark:border-red-950 dark:bg-red-950/35 dark:text-red-200" role="alert">
            <mat-icon class="mt-0.5">error</mat-icon>
            <p>{{ key | transloco }}</p>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="gap-3 px-6 pb-6 pt-5">
        <liass-button variant="outline" tone="neutral" [disabled]="submitting()" (pressed)="cancel()">
          {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
        </liass-button>
        <liass-button
          buttonType="submit"
          variant="solid"
          tone="brand"
          icon="add"
          [disabled]="form.invalid || submitting()"
          [loading]="submitting()"
        >
          {{ 'ACCOUNTING.FISCAL_YEAR.ACTIONS.CREATE_SUBMIT' | transloco }}
        </liass-button>
      </mat-dialog-actions>
    </form>
  `
})
export class CreateFiscalYearDialogComponent {
  private readonly accountingApi = inject(AccountingApi);
  private readonly data = inject<CreateFiscalYearDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<CreateFiscalYearDialogComponent, FiscalYearDto | null>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly errorKey = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    year: [this.data.year, [Validators.required, Validators.min(1900), Validators.max(2100)]]
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);
    this.errorMessage.set(null);

    try {
      const raw = this.form.getRawValue();
      const result = await this.accountingApi.createFiscalYear({
        year: Number(raw.year)
      });

      this.notification.success(
        result.message ?? this.transloco.translate('ACCOUNTING.NOTIFICATIONS.FISCAL_YEAR_CREATED')
      );
      this.dialogRef.close(result.data);
    } catch (error) {
      const fallbackKey = 'ACCOUNTING.FISCAL_YEAR.ERRORS.CREATE_FAILED';
      const userMessage = safeMessageFromError(error);

      this.errorKey.set(userMessage ? null : fallbackKey);
      this.errorMessage.set(userMessage);
      this.notification.error(userMessage ?? this.transloco.translate(fallbackKey));
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void {
    if (!this.submitting()) {
      this.dialogRef.close(null);
    }
  }
}

@Component({
  selector: 'liass-period-confirmation-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <header class="px-6 pt-6">
      <div class="flex items-start gap-3">
        <span class="inline-flex size-10 items-center justify-center rounded-app-control bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-200">
          <mat-icon>lock</mat-icon>
        </span>
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200">
            {{ 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.EYEBROW' | transloco }}
          </p>
          <h2 mat-dialog-title class="m-0 mt-2 p-0 text-2xl font-semibold text-slate-950 dark:text-white">
            {{ 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.LOCK_TITLE' | transloco }}
          </h2>
        </div>
      </div>
    </header>

    <mat-dialog-content class="px-6 pb-0 pt-5">
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{ 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.LOCK_DESCRIPTION' | transloco }}
      </p>
      <p class="mt-3 rounded-app-card border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
        {{ data.monthLabelKey | transloco }}
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="gap-3 px-6 pb-6 pt-5">
      <liass-button variant="outline" tone="neutral" (pressed)="cancel()">
        {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
      </liass-button>
      <liass-button variant="solid" tone="warning" icon="lock" (pressed)="confirm()">
        {{ 'ACCOUNTING.FISCAL_YEAR.ACTIONS.LOCK' | transloco }}
      </liass-button>
    </mat-dialog-actions>
  `
})
export class PeriodConfirmationDialogComponent {
  protected readonly data = inject<PeriodConfirmationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<PeriodConfirmationDialogComponent, boolean>>(
    MatDialogRef
  );

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected confirm(): void {
    this.dialogRef.close(true);
  }
}

@Component({
  selector: 'liass-fiscal-year-close-confirmation-dialog',
  imports: [
    LiassButtonComponent,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule,
    TranslocoModule
  ],
  template: `
    <header class="px-6 pt-6">
      <div class="flex items-start gap-3">
        <span class="inline-flex size-10 items-center justify-center rounded-app-control bg-danger-50 text-danger-600 dark:bg-rose-950/35 dark:text-rose-300">
          <mat-icon>lock</mat-icon>
        </span>
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-danger-600 dark:text-rose-300">
            {{ 'ACCOUNTING.CLOSING.CONFIRMATION.EYEBROW' | transloco }}
          </p>
          <h2 mat-dialog-title class="m-0 mt-2 p-0 text-2xl font-semibold text-slate-950 dark:text-white">
            {{ 'ACCOUNTING.CLOSING.CONFIRMATION.DIALOG_TITLE' | transloco }}
          </h2>
        </div>
      </div>
    </header>

    <mat-dialog-content class="px-6 pb-0 pt-5">
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{ 'ACCOUNTING.CLOSING.CONFIRMATION.COPY' | transloco }}
      </p>
      <p class="mt-3 rounded-app-card border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
        {{ 'ACCOUNTING.CLOSING.SUMMARY.FISCAL_YEAR' | transloco }} {{ data.fiscalYear.year }}
      </p>

      @if (data.hasWarnings) {
        <mat-checkbox
          class="mt-4 block text-sm text-slate-700 dark:text-slate-200"
          [checked]="warningsAcknowledged()"
          (change)="warningsAcknowledged.set($event.checked)"
        >
          {{ 'ACCOUNTING.CLOSING.CONFIRMATION.ACKNOWLEDGE_WARNINGS' | transloco }}
        </mat-checkbox>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="gap-3 px-6 pb-6 pt-5">
      <liass-button variant="outline" tone="neutral" (pressed)="cancel()">
        {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
      </liass-button>
      <liass-button
        variant="solid"
        tone="danger"
        icon="lock"
        [disabled]="data.hasWarnings && !warningsAcknowledged()"
        (pressed)="confirm()"
      >
        {{ 'ACCOUNTING.CLOSING.ACTIONS.CLOSE_YEAR' | transloco }}
      </liass-button>
    </mat-dialog-actions>
  `
})
export class FiscalYearCloseConfirmationDialogComponent {
  protected readonly data = inject<FiscalYearCloseConfirmationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<FiscalYearCloseConfirmationDialogComponent, boolean>>(
    MatDialogRef
  );
  protected readonly warningsAcknowledged = signal(false);

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected confirm(): void {
    if (this.data.hasWarnings && !this.warningsAcknowledged()) {
      return;
    }

    this.dialogRef.close(true);
  }
}

@Component({
  selector: 'liass-fiscal-year-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './fiscal-year.page.html'
})
export class FiscalYearPage {
  protected readonly authStore = inject(AuthStore);
  protected readonly canWriteAccounting = () => !this.authStore.isAccountingReadOnly?.();
  private readonly accountingApi = inject(AccountingApi);
  private readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly currentYear = new Date().getFullYear();
  protected readonly closeErrorMessage = signal<string | null>(null);
  protected readonly closeResult = signal<FiscalYearDto | null>(null);
  protected readonly closingFiscalYear = signal(false);
  protected readonly requestedYear = signal<number | null>(null);
  protected readonly pendingPeriod = signal<string | null>(null);
  protected readonly errorKey = signal<string | null>(null);
  // TODO(accounting): replace the single-year selector with a list when fiscal-year listing is available.

  protected readonly periods: FiscalPeriod[] = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');

    return {
      month,
      labelKey: `ACCOUNTING.FISCAL_YEAR.MONTHS.${month}`
    };
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    year: [
      this.currentYear,
      [Validators.required, Validators.min(1900), Validators.max(2100)]
    ]
  });

  protected readonly fiscalYearQuery = injectQuery(() =>
    this.accountingQueries.fiscalYearDetails(
      this.requestedYear() ?? '',
      this.requestedYear() !== null
    )
  );
  protected readonly closingChecksQuery = injectQuery(() =>
    this.accountingQueries.closingChecks(
      this.requestedYear() ?? '',
      this.requestedYear() !== null
    )
  );

  protected readonly details = computed(() => this.fiscalYearQuery.data() ?? null);
  protected readonly closingChecks = computed(() => this.closingChecksQuery.data() ?? null);
  protected readonly lockedPeriodsCount = computed(() =>
    this.periods.filter((period) => this.periodStatus(period.month) === 'LOCKED').length
  );
  protected readonly openPeriodsCount = computed(() => 12 - this.lockedPeriodsCount());
  protected readonly readinessTone = computed<LiassStatusTone>(() => {
    const details = this.details();
    const checks = this.closingChecks();

    if (details?.status === 'CLOSED') {
      return 'neutral';
    }

    if (!checks) {
      return 'neutral';
    }

    if (!checks.canClose) {
      return 'danger';
    }

    return checks.warnings.length > 0 ? 'warning' : 'success';
  });
  protected readonly readinessLabelKey = computed(() => {
    const details = this.details();
    const checks = this.closingChecks();

    if (details?.status === 'CLOSED') {
      return 'ACCOUNTING.CLOSING.STATUS.CLOSED';
    }

    if (!checks) {
      return 'ACCOUNTING.CLOSING.STATUS.UNAVAILABLE';
    }

    if (!checks.canClose) {
      return 'ACCOUNTING.CLOSING.STATUS.BLOCKED';
    }

    return checks.warnings.length > 0
      ? 'ACCOUNTING.CLOSING.STATUS.WARNINGS'
      : 'ACCOUNTING.CLOSING.STATUS.READY';
  });

  constructor() {
    effect(() => {
      const details = this.details();

      if (details) {
        untracked(() => this.fiscalYearContext.selectFiscalYear(details));
      }
    });

    effect(() => {
      this.requestedYear();
      untracked(() => {
        this.closeErrorMessage.set(null);
        this.closeResult.set(null);
      });
    });
  }

  protected fiscalYearStatusTone(status: FiscalYearDetailsDto['status']): LiassStatusTone {
    if (status === 'OPEN') {
      return 'success';
    }

    if (status === 'LOCKED') {
      return 'warning';
    }

    if (status === 'CLOSED') {
      return 'neutral';
    }

    return 'info';
  }

  protected periodStatus(month: string): 'LOCKED' | 'OPEN' {
    return this.details()?.periodLocks[month] ?? 'OPEN';
  }

  protected periodTone(month: string): LiassStatusTone {
    return this.periodStatus(month) === 'LOCKED' ? 'warning' : 'success';
  }

  protected loadSelectedYear(): void {
    if (this.form.controls.year.invalid) {
      this.form.controls.year.markAsTouched();
      return;
    }

    this.errorKey.set(null);
    this.requestedYear.set(Number(this.form.controls.year.value));
  }

  protected openCreateFiscalYear(): void {
    const dialogRef = this.dialog.open(CreateFiscalYearDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        year: Number(this.form.controls.year.value) || this.requestedYear() || this.currentYear
      },
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'liass-dialog-panel',
      restoreFocus: true,
      width: '560px'
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe((fiscalYear: FiscalYearDto | null | undefined) => {
      if (fiscalYear) {
        this.errorKey.set(null);
        this.fiscalYearContext.selectFiscalYear(fiscalYear);
        this.form.controls.year.setValue(fiscalYear.year);
        this.requestedYear.set(fiscalYear.year);
        void this.fiscalYearQuery.refetch();
      }
    });
  }

  protected togglePeriod(month: string): void {
    const details = this.details();

    if (!details || details.status === 'CLOSED' || this.pendingPeriod()) {
      return;
    }

    const period = this.periods.find((candidate) => candidate.month === month);
    if (this.periodStatus(month) === 'LOCKED') {
      return;
    }

    this.dialog
      .open(PeriodConfirmationDialogComponent, {
        autoFocus: 'first-tabbable',
        data: {
          monthLabelKey: period?.labelKey ?? `ACCOUNTING.FISCAL_YEAR.MONTHS.${month}`
        },
        maxWidth: 'calc(100vw - 32px)',
        panelClass: 'liass-dialog-panel',
        restoreFocus: true,
        width: '520px'
      })
      .afterClosed()
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (confirmed) {
          void this.applyPeriodUpdate(month);
        }
      });
  }

  protected canCloseFiscalYear(): boolean {
    const details = this.details();
    const checks = this.closingChecks();

    return !!details && details.status !== 'CLOSED' && !!checks?.canClose && !this.closingFiscalYear();
  }

  protected issueText(issue: ClosingIssueDto): string {
    return issue.message?.trim() || this.transloco.translate(this.issueLabelKey(issue.code));
  }

  protected issueMeta(issue: ClosingIssueDto): string {
    const parts = [
      issue.entryId ? this.transloco.translate('ACCOUNTING.CLOSING.ISSUES.META.ENTRY', { entryId: issue.entryId }) : null,
      issue.lineId ? this.transloco.translate('ACCOUNTING.CLOSING.ISSUES.META.LINE', { lineId: issue.lineId }) : null,
      issue.accountId
        ? this.transloco.translate('ACCOUNTING.CLOSING.ISSUES.META.ACCOUNT', { accountId: issue.accountId })
        : null,
      issue.journalCode
        ? this.transloco.translate('ACCOUNTING.CLOSING.ISSUES.META.JOURNAL', { journalCode: issue.journalCode })
        : null,
      issue.thirdPartyId
        ? this.transloco.translate('ACCOUNTING.CLOSING.ISSUES.META.THIRD_PARTY', { thirdPartyId: issue.thirdPartyId })
        : null
    ].filter((part): part is string => !!part);

    return parts.join(' · ');
  }

  protected formatAmount(value: number): string {
    const locale = this.transloco.getActiveLang() === 'en' ? 'en-US' : 'fr-FR';

    return new Intl.NumberFormat(locale).format(value);
  }

  protected async confirmCloseFiscalYear(): Promise<void> {
    const details = this.details();
    const checks = this.closingChecks();

    if (!details || !checks?.canClose || this.closingFiscalYear() || details.status === 'CLOSED') {
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      this.dialog
        .open(FiscalYearCloseConfirmationDialogComponent, {
          autoFocus: 'first-tabbable',
          data: {
            fiscalYear: details,
            hasWarnings: checks.warnings.length > 0
          },
          disableClose: true,
          maxWidth: 'calc(100vw - 32px)',
          panelClass: 'liass-dialog-panel',
          restoreFocus: true,
          width: '560px'
        })
        .afterClosed()
        .pipe(take(1))
        .subscribe((result) => resolve(result === true));
    });

    if (!confirmed) {
      return;
    }

    this.closingFiscalYear.set(true);
    this.closeErrorMessage.set(null);
    this.closeResult.set(null);

    try {
      const result = await this.accountingApi.closeFiscalYear(details.year, checks.warnings.length > 0);

      this.closeResult.set(result.data.fiscalYear);
      this.fiscalYearContext.selectFiscalYear(result.data.fiscalYear);
      this.notification.success(
        result.message ?? this.transloco.translate('ACCOUNTING.CLOSING.NOTIFICATIONS.YEAR_CLOSED')
      );
      await this.fiscalYearQuery.refetch();
      await this.closingChecksQuery.refetch();
    } catch (error) {
      const fallback = this.transloco.translate('ACCOUNTING.CLOSING.ERRORS.CLOSE_FAILED');
      const message = safeMessageFromError(error) ?? fallback;

      this.closeErrorMessage.set(message);
      this.notification.error(message);
    } finally {
      this.closingFiscalYear.set(false);
    }
  }

  private async applyPeriodUpdate(month: string): Promise<void> {
    const details = this.details();

    if (!details || details.status === 'CLOSED' || this.pendingPeriod()) {
      return;
    }

    this.pendingPeriod.set(month);
    this.errorKey.set(null);

    try {
      const monthNumber = Number(month);
      const result = await this.accountingApi.closePeriod(details.year, monthNumber);
      const fallbackKey = 'ACCOUNTING.NOTIFICATIONS.PERIOD_LOCKED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      await this.fiscalYearQuery.refetch();
      await this.closingChecksQuery.refetch();
    } catch (error) {
      const fallbackKey = 'ACCOUNTING.FISCAL_YEAR.ERRORS.PERIOD_UPDATE_FAILED';

      this.errorKey.set(fallbackKey);
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate(fallbackKey));
    } finally {
      this.pendingPeriod.set(null);
    }
  }

  private issueLabelKey(code: string): string {
    const labels: Record<string, string> = {
      ACCOUNT_AUXILIARY_CONFIGURATION_INVALID: 'ACCOUNTING.CLOSING.ISSUES.ACCOUNT_AUXILIARY_CONFIGURATION_INVALID',
      ACCOUNT_INACTIVE: 'ACCOUNTING.CLOSING.ISSUES.ACCOUNT_INACTIVE',
      ACCOUNT_NOT_FOUND: 'ACCOUNTING.CLOSING.ISSUES.ACCOUNT_NOT_FOUND',
      AUXILIARY_THIRD_PARTY_REQUIRED: 'ACCOUNTING.CLOSING.ISSUES.AUXILIARY_THIRD_PARTY_REQUIRED',
      AUXILIARY_THIRD_PARTY_TYPE_MISMATCH: 'ACCOUNTING.CLOSING.ISSUES.AUXILIARY_THIRD_PARTY_TYPE_MISMATCH',
      DRAFT_ENTRIES_REMAIN: 'ACCOUNTING.CLOSING.ISSUES.DRAFT_ENTRIES_REMAIN',
      ENTRY_NOT_BALANCED: 'ACCOUNTING.CLOSING.ISSUES.ENTRY_NOT_BALANCED',
      FISCAL_YEAR_NOT_OPEN: 'ACCOUNTING.CLOSING.ISSUES.FISCAL_YEAR_NOT_OPEN',
      JOURNAL_NOT_FOUND: 'ACCOUNTING.CLOSING.ISSUES.JOURNAL_NOT_FOUND',
      TRIAL_BALANCE_NOT_BALANCED: 'ACCOUNTING.CLOSING.ISSUES.TRIAL_BALANCE_NOT_BALANCED',
      UNLETTERED_AUXILIARY_LINES_REMAIN: 'ACCOUNTING.CLOSING.ISSUES.UNLETTERED_AUXILIARY_LINES_REMAIN',
      UNPOSTED_ENTRY_INCLUDED_IN_BOOKS: 'ACCOUNTING.CLOSING.ISSUES.UNPOSTED_ENTRY_INCLUDED_IN_BOOKS'
    };

    return labels[code] ?? 'ACCOUNTING.CLOSING.ISSUES.GENERIC';
  }
}
