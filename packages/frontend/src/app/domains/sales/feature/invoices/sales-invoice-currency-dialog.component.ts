import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CurrencyCodeSchema, type SalesInvoice } from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { isSalesInvoiceVersionConflict, salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';

@Component({
  selector: 'liass-sales-invoice-currency-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, TranslocoModule],
  template: `
    <header class="px-5 pt-5 sm:px-6 sm:pt-6">
      <h2 mat-dialog-title class="m-0 p-0 text-xl font-semibold text-app-text">{{ 'SALES.INVOICES.CURRENCY_DIALOG.TITLE' | transloco }}</h2>
      <p class="mt-1 text-sm text-app-text-secondary">{{ 'SALES.INVOICES.CURRENCY_DIALOG.SUBTITLE' | transloco }}</p>
    </header>
    <mat-dialog-content class="px-5 py-4 sm:px-6">
      <form [formGroup]="form" (ngSubmit)="submit()" id="invoice-currency-form">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'SALES.INVOICES.FIELDS.CURRENCY' | transloco }}</mat-label>
          <input matInput formControlName="currency" maxlength="3" autocomplete="off" (input)="uppercase()" />
          <mat-hint>{{ 'SALES.INVOICES.CURRENCY_DIALOG.HINT' | transloco }}</mat-hint>
          @if (form.controls.currency.invalid && form.controls.currency.touched) { <mat-error>{{ 'SALES.INVOICES.VALIDATION.CURRENCY' | transloco }}</mat-error> }
        </mat-form-field>
        @if (errorMessage()) { <p class="rounded-app-control border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{{ errorMessage() }}</p> }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="gap-2 px-5 pb-5 sm:px-6 sm:pb-6">
      <liass-button [disabled]="submitting()" (pressed)="cancel()">{{ 'COMMON.ACTIONS.CANCEL' | transloco }}</liass-button>
      <liass-button tone="brand" variant="solid" [loading]="submitting()" (pressed)="submit()">{{ 'COMMON.ACTIONS.SAVE' | transloco }}</liass-button>
    </mat-dialog-actions>
  `
})
export class SalesInvoiceCurrencyDialogComponent {
  protected readonly invoice = inject<SalesInvoice>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesInvoicesApi);
  private readonly dialogRef = inject<MatDialogRef<SalesInvoiceCurrencyDialogComponent, SalesInvoice | null>>(MatDialogRef);
  private readonly notification = inject(NotificationService);
  private readonly queries = inject(SalesInvoicesQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    currency: [this.invoice.currency, [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]]
  });

  protected uppercase(): void {
    const value = this.form.controls.currency.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    this.form.controls.currency.setValue(value, { emitEvent: false });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) { this.form.markAllAsTouched(); return; }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const currency = CurrencyCodeSchema.parse(this.form.controls.currency.value);
      const result = await this.api.update(this.invoice.id, { expectedVersion: this.invoice.version, currency });
      this.notification.success(result.message ?? this.transloco.translate('SALES.INVOICES.NOTIFICATIONS.UPDATED'));
      this.dialogRef.close(result.data);
    } catch (error) {
      const code = salesInvoiceErrorCode(error);
      const key = isSalesInvoiceVersionConflict(error) ? 'SALES.INVOICES.ERRORS.CONFLICT'
        : code === 'INVOICE_CURRENCY_LOCKED' ? 'SALES.INVOICES.ERRORS.CURRENCY_LOCKED'
        : code === 'UNSUPPORTED_CURRENCY' ? 'SALES.INVOICES.ERRORS.UNSUPPORTED_CURRENCY'
        : 'SALES.INVOICES.ERRORS.UPDATE_FAILED';
      const knownDomainError = isSalesInvoiceVersionConflict(error) || code === 'INVOICE_CURRENCY_LOCKED' || code === 'UNSUPPORTED_CURRENCY';
      const message = knownDomainError
        ? this.transloco.translate<string>(key) ?? key
        : safeMessageFromError(error) ?? this.transloco.translate<string>(key) ?? key;
      this.errorMessage.set(message);
      this.notification.error(message);
      if (isSalesInvoiceVersionConflict(error)) {
        await Promise.all([
          this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(this.invoice.id) }),
          this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() })
        ]);
      }
    } finally { this.submitting.set(false); }
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }
}
