import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type CloseFiscalYearResultDto,
  type CreateFiscalYearRequest,
  type FiscalYearDetailsDto
} from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { AuthStore } from '../../../identity/data-access/auth.store';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../../shared/ui/status-chip/status-chip.component';
import { AccountingApi } from '../../data-access/accounting.api';
import { AccountingQueries } from '../../data-access/accounting-queries';

interface FiscalPeriod {
  month: string;
  labelKey: string;
}

@Component({
  selector: 'liass-close-fiscal-year-dialog',
  imports: [LiassButtonComponent, MatDialogModule, TranslocoModule],
  template: `
    <h2 mat-dialog-title>{{ 'ACCOUNTING.FISCAL_YEAR.CLOSE_DIALOG.TITLE' | transloco }}</h2>
    <mat-dialog-content>
      <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {{ 'ACCOUNTING.FISCAL_YEAR.CLOSE_DIALOG.DESCRIPTION' | transloco }}
      </p>
      <p class="mt-3 rounded-app-card border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        {{ 'ACCOUNTING.FISCAL_YEAR.CLOSE_DIALOG.WARNING' | transloco }}
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <liass-button variant="ghost" tone="neutral" (pressed)="cancel()">
        {{ 'ACCOUNTING.FISCAL_YEAR.CLOSE_DIALOG.CANCEL' | transloco }}
      </liass-button>
      <liass-button variant="solid" tone="danger" icon="lock" (pressed)="confirm()">
        {{ 'ACCOUNTING.FISCAL_YEAR.CLOSE_DIALOG.CONFIRM' | transloco }}
      </liass-button>
    </mat-dialog-actions>
  `
})
export class CloseFiscalYearDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<CloseFiscalYearDialogComponent>);

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
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './fiscal-year.page.html'
})
export class FiscalYearPage {
  private readonly accountingApi = inject(AccountingApi);
  private readonly accountingQueries = inject(AccountingQueries);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly currentYear = new Date().getFullYear();
  protected readonly selectedYear = signal(this.currentYear);
  protected readonly submittingCreate = signal(false);
  protected readonly pendingPeriod = signal<string | null>(null);
  protected readonly closing = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly successKey = signal<string | null>(null);
  protected readonly closeResult = signal<CloseFiscalYearResultDto | null>(null);

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
    ],
    accountingFramework: [
      this.defaultAccountingFramework(),
      [Validators.required]
    ]
  });

  protected readonly fiscalYearQuery = injectQuery(() =>
    this.accountingQueries.fiscalYearDetails(this.selectedYear())
  );

  protected readonly details = computed(() => this.fiscalYearQuery.data() ?? null);
  protected readonly lockedPeriodsCount = computed(() =>
    this.periods.filter((period) => this.periodStatus(period.month) === 'LOCKED').length
  );
  protected readonly openPeriodsCount = computed(() => 12 - this.lockedPeriodsCount());

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
    this.successKey.set(null);
    this.closeResult.set(null);
    this.selectedYear.set(Number(this.form.controls.year.value));
  }

  protected async createFiscalYear(): Promise<void> {
    if (this.form.invalid || this.submittingCreate()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submittingCreate.set(true);
    this.errorKey.set(null);
    this.successKey.set(null);
    this.closeResult.set(null);

    try {
      const raw = this.form.getRawValue();
      await this.accountingApi.createFiscalYear({
        year: Number(raw.year),
        accountingFramework: raw.accountingFramework as CreateFiscalYearRequest['accountingFramework']
      });
      this.selectedYear.set(Number(raw.year));
      this.successKey.set('ACCOUNTING.FISCAL_YEAR.MESSAGES.CREATED');
      void this.fiscalYearQuery.refetch();
    } catch {
      this.errorKey.set('ACCOUNTING.FISCAL_YEAR.ERRORS.CREATE_FAILED');
    } finally {
      this.submittingCreate.set(false);
    }
  }

  protected async togglePeriod(month: string): Promise<void> {
    const details = this.details();

    if (!details || details.status === 'CLOSED' || this.pendingPeriod()) {
      return;
    }

    this.pendingPeriod.set(month);
    this.errorKey.set(null);
    this.successKey.set(null);

    try {
      const monthNumber = Number(month);

      if (this.periodStatus(month) === 'LOCKED') {
        await this.accountingApi.unlockPeriod(details.year, monthNumber);
        this.successKey.set('ACCOUNTING.FISCAL_YEAR.MESSAGES.UNLOCKED');
      } else {
        await this.accountingApi.lockPeriod(details.year, monthNumber);
        this.successKey.set('ACCOUNTING.FISCAL_YEAR.MESSAGES.LOCKED');
      }

      void this.fiscalYearQuery.refetch();
    } catch {
      this.errorKey.set('ACCOUNTING.FISCAL_YEAR.ERRORS.PERIOD_UPDATE_FAILED');
    } finally {
      this.pendingPeriod.set(null);
    }
  }

  protected confirmCloseYear(): void {
    if (!this.details() || this.details()?.status === 'CLOSED' || this.closing()) {
      return;
    }

    this.dialog
      .open(CloseFiscalYearDialogComponent, {
        autoFocus: 'first-tabbable',
        disableClose: true,
        maxWidth: 'calc(100vw - 32px)',
        panelClass: 'liass-dialog-panel',
        restoreFocus: true,
        width: '560px'
      })
      .afterClosed()
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (confirmed) {
          void this.closeYear();
        }
      });
  }

  protected formatAmount(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  private async closeYear(): Promise<void> {
    const details = this.details();

    if (!details) {
      return;
    }

    this.closing.set(true);
    this.errorKey.set(null);
    this.successKey.set(null);
    this.closeResult.set(null);

    try {
      const result = await this.accountingApi.closeFiscalYear(details.year);
      this.closeResult.set(result);
      this.successKey.set('ACCOUNTING.FISCAL_YEAR.MESSAGES.CLOSED');
      void this.fiscalYearQuery.refetch();
    } catch {
      this.errorKey.set('ACCOUNTING.FISCAL_YEAR.ERRORS.CLOSE_FAILED');
    } finally {
      this.closing.set(false);
    }
  }

  private defaultAccountingFramework(): CreateFiscalYearRequest['accountingFramework'] {
    const activeFramework =
      this.authStore.activeDossier()?.accountingFramework ??
      this.authStore.activeWorkspace()?.accountingFramework;

    return activeFramework === 'SYCEBNL' ? 'SYCEBNL' : 'SYSCOHADA_REVISED';
  }
}
