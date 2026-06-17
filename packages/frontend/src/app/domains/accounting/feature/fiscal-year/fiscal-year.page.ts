import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  type FiscalYearDto,
  type FiscalYearDetailsDto
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

interface FiscalPeriod {
  month: string;
  labelKey: string;
}

interface CreateFiscalYearDialogData {
  year: number;
}

interface PeriodConfirmationDialogData {
  action: 'LOCK' | 'UNLOCK';
  monthLabelKey: string;
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
          <mat-icon>{{ data.action === 'LOCK' ? 'lock' : 'lock_open' }}</mat-icon>
        </span>
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200">
            {{ 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.EYEBROW' | transloco }}
          </p>
          <h2 mat-dialog-title class="m-0 mt-2 p-0 text-2xl font-semibold text-slate-950 dark:text-white">
            {{
              (data.action === 'LOCK'
                ? 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.LOCK_TITLE'
                : 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.UNLOCK_TITLE'
              ) | transloco
            }}
          </h2>
        </div>
      </div>
    </header>

    <mat-dialog-content class="px-6 pb-0 pt-5">
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{
          (data.action === 'LOCK'
            ? 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.LOCK_DESCRIPTION'
            : 'ACCOUNTING.FISCAL_YEAR.PERIOD_CONFIRM.UNLOCK_DESCRIPTION'
          ) | transloco
        }}
      </p>
      <p class="mt-3 rounded-app-card border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
        {{ data.monthLabelKey | transloco }}
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="gap-3 px-6 pb-6 pt-5">
      <liass-button variant="outline" tone="neutral" (pressed)="cancel()">
        {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
      </liass-button>
      <liass-button variant="solid" tone="warning" [icon]="data.action === 'LOCK' ? 'lock' : 'lock_open'" (pressed)="confirm()">
        {{
          (data.action === 'LOCK'
            ? 'ACCOUNTING.FISCAL_YEAR.ACTIONS.LOCK'
            : 'ACCOUNTING.FISCAL_YEAR.ACTIONS.UNLOCK'
          ) | transloco
        }}
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
  selector: 'liass-fiscal-year-page',
  imports: [
    LiassButtonComponent,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './fiscal-year.page.html'
})
export class FiscalYearPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly fiscalYearContext = inject(AccountingFiscalYearContextService);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly dialog = inject(MatDialog);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly currentYear = new Date().getFullYear();
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

  protected readonly details = computed(() => this.fiscalYearQuery.data() ?? null);
  protected readonly lockedPeriodsCount = computed(() =>
    this.periods.filter((period) => this.periodStatus(period.month) === 'LOCKED').length
  );
  protected readonly openPeriodsCount = computed(() => 12 - this.lockedPeriodsCount());

  constructor() {
    effect(() => {
      const details = this.details();

      if (details) {
        untracked(() => this.fiscalYearContext.selectFiscalYear(details));
      }
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
    const action = this.periodStatus(month) === 'LOCKED' ? 'UNLOCK' : 'LOCK';

    this.dialog
      .open(PeriodConfirmationDialogComponent, {
        autoFocus: 'first-tabbable',
        data: {
          action,
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

  protected closingPreparationDisabled(): boolean {
    // TODO(accounting): enable final close only after OHADA annual close controls and statements are modeled end-to-end.
    return true;
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
      const wasLocked = this.periodStatus(month) === 'LOCKED';
      const result = wasLocked
        ? await this.accountingApi.unlockPeriod(details.year, monthNumber)
        : await this.accountingApi.lockPeriod(details.year, monthNumber);
      const fallbackKey = wasLocked
        ? 'ACCOUNTING.NOTIFICATIONS.PERIOD_UNLOCKED'
        : 'ACCOUNTING.NOTIFICATIONS.PERIOD_LOCKED';

      this.notification.success(result.message ?? this.transloco.translate(fallbackKey));
      void this.fiscalYearQuery.refetch();
    } catch (error) {
      const fallbackKey = 'ACCOUNTING.FISCAL_YEAR.ERRORS.PERIOD_UPDATE_FAILED';

      this.errorKey.set(fallbackKey);
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate(fallbackKey));
    } finally {
      this.pendingPeriod.set(null);
    }
  }
}
