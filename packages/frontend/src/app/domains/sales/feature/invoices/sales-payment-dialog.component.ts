import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, type ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  RecordSalesPaymentRequestSchema,
  SalesPaymentAmountSchema,
  type RecordSalesPaymentRequest,
  type RecordSalesPaymentResponse,
  type SalesInvoiceReceivable,
  type SalesPaymentMethod
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { ZodType } from 'zod';

import { safeMessageFromError, type ApiMutationResult } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesPaymentsApi } from '../../data-access/sales-payments.api';
import { SalesPaymentsQueries } from '../../data-access/sales-payments.queries';
import { formatExactMoney } from '../../utils/exact-money-display';
import { localCalendarDate } from '../../utils/sales-invoice-dates';
import { salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';
import {
  createSalesPaymentRequestId,
  isAmbiguousSalesPaymentFailure
} from '../../utils/sales-payment-attempt';

export interface SalesPaymentDialogData {
  invoiceId: string;
  invoiceNumber: string;
  receivable: SalesInvoiceReceivable;
}

export type SalesPaymentDialogResult = ApiMutationResult<RecordSalesPaymentResponse>;

const PAYMENT_METHODS: readonly SalesPaymentMethod[] = [
  'CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_MONEY', 'CHEQUE', 'OTHER'
];

@Component({
  selector: 'liass-sales-payment-dialog',
  host: { class: 'block' },
  imports: [
    LiassButtonComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  templateUrl: './sales-payment-dialog.component.html'
})
export class SalesPaymentDialogComponent {
  protected readonly data = inject<SalesPaymentDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesPaymentsApi);
  private readonly dialogRef = inject<MatDialogRef<SalesPaymentDialogComponent, SalesPaymentDialogResult | null>>(MatDialogRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly paymentQueries = inject(SalesPaymentsQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly receivable = signal(this.data.receivable);
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly ambiguous = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly errorTone = signal<'danger' | 'warning'>('danger');
  protected readonly settled = computed(() => this.receivable().status === 'SETTLED');
  private readonly attempt = signal<RecordSalesPaymentRequest | null>(null);

  protected readonly form = this.formBuilder.group({
    amount: ['', [Validators.required, zodValidator(SalesPaymentAmountSchema)]],
    paymentDate: [localCalendarDate(), Validators.required],
    method: ['' as SalesPaymentMethod | '', Validators.required],
    reference: ['', Validators.maxLength(200)]
  });

  protected money(value: string): string {
    return formatExactMoney(value, this.receivable().currency, this.transloco.getActiveLang());
  }

  protected methodKey(method: SalesPaymentMethod): string {
    return `SALES.INVOICES.SETTLEMENT.METHODS.${method}`;
  }

  protected payRemaining(): void {
    if (this.form.disabled) return;
    this.form.controls.amount.setValue(this.receivable().balanceDue);
    this.form.controls.amount.markAsDirty();
  }

  protected reviewDetails(): void {
    if (this.submitting()) return;
    this.attempt.set(null);
    this.ambiguous.set(false);
    this.errorMessage.set(null);
    this.form.enable({ emitEvent: false });
  }

  protected cancel(): void {
    if (!this.submitting()) this.dialogRef.close(null);
  }

  protected async submit(): Promise<void> {
    if (this.submitting() || this.settled()) return;
    this.submitted.set(true);

    let request = this.attempt();
    if (!request) {
      const raw = this.form.getRawValue();
      const parsed = RecordSalesPaymentRequestSchema.safeParse({
        expectedVersion: this.receivable().version,
        clientRequestId: createSalesPaymentRequestId(),
        amount: raw.amount,
        paymentDate: raw.paymentDate,
        method: raw.method,
        reference: raw.reference?.trim() || undefined
      });
      if (!parsed.success) {
        this.form.markAllAsTouched();
        return;
      }
      request = parsed.data;
      this.attempt.set(request);
      this.form.disable({ emitEvent: false });
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const result = await this.api.recordPayment(this.data.invoiceId, request);
      this.dialogRef.close(result);
    } catch (error) {
      await this.handleFailure(error);
    } finally {
      this.submitting.set(false);
    }
  }

  private async handleFailure(error: unknown): Promise<void> {
    const code = salesInvoiceErrorCode(error);
    if (isAmbiguousSalesPaymentFailure(error)) {
      this.ambiguous.set(true);
      this.errorTone.set('warning');
      this.errorMessage.set(this.transloco.translate('SALES.INVOICES.SETTLEMENT.ERRORS.AMBIGUOUS'));
      return;
    }

    const recoveryCodes = new Set([
      'SALES_RECEIVABLE_VERSION_CONFLICT',
      'SALES_INVOICE_ALREADY_SETTLED',
      'SALES_PAYMENT_IDEMPOTENCY_KEY_REUSED',
      'SALES_PAYMENT_CONCURRENCY_CONFLICT'
    ]);
    if (code && recoveryCodes.has(code)) await this.refreshSettlement();

    this.attempt.set(null);
    this.ambiguous.set(false);
    this.form.enable({ emitEvent: false });
    this.errorTone.set(code === 'SALES_RECEIVABLE_VERSION_CONFLICT' ? 'warning' : 'danger');
    const errorKey = paymentErrorKey(code);
    this.errorMessage.set(
      safeMessageFromError(error) ?? this.transloco.translate(errorKey)
    );
  }

  private async refreshSettlement(): Promise<void> {
    try {
      const current = await this.api.getReceivable(this.data.invoiceId);
      this.receivable.set(current);
      this.queryClient.setQueryData(this.paymentQueries.receivableKey(this.data.invoiceId), current);
      await this.queryClient.invalidateQueries({
        queryKey: this.paymentQueries.paymentsRootKey(this.data.invoiceId)
      });
    } catch {
      await Promise.all([
        this.queryClient.invalidateQueries({ queryKey: this.paymentQueries.receivableKey(this.data.invoiceId) }),
        this.queryClient.invalidateQueries({ queryKey: this.paymentQueries.paymentsRootKey(this.data.invoiceId) })
      ]);
    }
  }
}

function paymentErrorKey(code: string | null): string {
  const keys: Record<string, string> = {
    SALES_RECEIVABLE_VERSION_CONFLICT: 'SALES.INVOICES.SETTLEMENT.ERRORS.VERSION_CONFLICT',
    SALES_PAYMENT_EXCEEDS_BALANCE: 'SALES.INVOICES.SETTLEMENT.ERRORS.EXCEEDS_BALANCE',
    SALES_PAYMENT_PRECISION_INVALID: 'SALES.INVOICES.SETTLEMENT.ERRORS.PRECISION',
    SALES_INVOICE_ALREADY_SETTLED: 'SALES.INVOICES.SETTLEMENT.ERRORS.ALREADY_SETTLED',
    SALES_PAYMENT_IDEMPOTENCY_KEY_REUSED: 'SALES.INVOICES.SETTLEMENT.ERRORS.IDEMPOTENCY_REUSED',
    SALES_PAYMENT_CONCURRENCY_CONFLICT: 'SALES.INVOICES.SETTLEMENT.ERRORS.VERSION_CONFLICT'
  };
  return code ? keys[code] ?? 'SALES.INVOICES.SETTLEMENT.ERRORS.RECORD_FAILED' : 'SALES.INVOICES.SETTLEMENT.ERRORS.RECORD_FAILED';
}

function zodValidator(schema: ZodType): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    schema.safeParse(control.value).success ? null : { exactAmount: true };
}
