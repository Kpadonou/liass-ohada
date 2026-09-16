import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, type ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  SalesInvoiceQuantitySchema,
  type SalesCreditNote,
  type SalesCreditNoteLine,
  type SalesIssuedInvoice,
  type SalesInvoiceLine
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import type { ZodType } from 'zod';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { formatExactMoney } from '../../utils/exact-money-display';
import { salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';

export interface SalesCreditNoteLineDialogData {
  invoice: SalesIssuedInvoice;
  creditNote: SalesCreditNote;
  line?: SalesCreditNoteLine;
}

export type SalesCreditNoteLineDialogResult =
  | { kind: 'updated'; creditNote: SalesCreditNote }
  | { kind: 'conflict' };

@Component({
  selector: 'liass-sales-credit-note-line-dialog',
  host: { class: 'block' },
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './sales-credit-note-line-dialog.component.html'
})
export class SalesCreditNoteLineDialogComponent {
  protected readonly data = inject<SalesCreditNoteLineDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesCreditNotesApi);
  private readonly dialogRef = inject<MatDialogRef<SalesCreditNoteLineDialogComponent, SalesCreditNoteLineDialogResult | null>>(MatDialogRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly isEdit = !!this.data.line;
  protected readonly selectedSourceLine = signal<SalesInvoiceLine | null>(this.sourceForEditedLine());
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly availableLines = computed(() => this.data.invoice.lines.filter((source) =>
    !this.data.creditNote.lines.some((line) => line.originalInvoiceLineId === source.id)
  ));
  protected readonly form = this.formBuilder.nonNullable.group({
    quantity: [this.data.line?.quantity ?? '1', [Validators.required, zodValidator(SalesInvoiceQuantitySchema)]]
  });

  protected money(value: string): string {
    return formatExactMoney(value, this.data.creditNote.currency, this.transloco.getActiveLang());
  }

  protected selectSource(line: SalesInvoiceLine): void {
    if (!this.isEdit) {
      this.selectedSourceLine.set(line);
      this.errorMessage.set(null);
    }
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting() || !this.selectedSourceLine() || this.data.creditNote.status !== 'DRAFT') {
      this.form.markAllAsTouched();
      if (!this.selectedSourceLine()) this.errorMessage.set(this.transloco.translate('SALES.CREDIT_NOTES.LINE_DIALOG.SOURCE_REQUIRED'));
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const quantity = this.form.controls.quantity.value;
      const result = this.isEdit
        ? await this.api.updateLine(this.data.invoice.id, this.data.creditNote.id, this.data.line!.id, {
            expectedVersion: this.data.creditNote.version,
            quantity
          })
        : await this.api.addLine(this.data.invoice.id, this.data.creditNote.id, {
            expectedVersion: this.data.creditNote.version,
            originalInvoiceLineId: this.selectedSourceLine()!.id,
            quantity
          });
      this.notification.success(result.message ?? this.transloco.translate(
        this.isEdit ? 'SALES.CREDIT_NOTES.NOTIFICATIONS.LINE_UPDATED' : 'SALES.CREDIT_NOTES.NOTIFICATIONS.LINE_ADDED'
      ));
      this.dialogRef.close({ kind: 'updated', creditNote: result.data });
    } catch (error) {
      const code = salesInvoiceErrorCode(error);
      if (code === 'SALES_CREDIT_NOTE_VERSION_CONFLICT') {
        this.dialogRef.close({ kind: 'conflict' });
        return;
      }
      const key = creditLineErrorKey(code, this.isEdit);
      const known = !!code && code in CREDIT_LINE_ERROR_KEYS;
      const message = known ? this.transloco.translate(key) : safeMessageFromError(error) ?? this.transloco.translate(key);
      this.errorMessage.set(message ?? key);
      this.notification.error(message ?? key);
    } finally { this.submitting.set(false); }
  }

  private sourceForEditedLine(): SalesInvoiceLine | null {
    return this.data.line
      ? this.data.invoice.lines.find((line) => line.id === this.data.line!.originalInvoiceLineId) ?? null
      : null;
  }
}

const CREDIT_LINE_ERROR_KEYS: Record<string, string> = {
  SALES_CREDIT_NOTE_SOURCE_LINE_DUPLICATE: 'SALES.CREDIT_NOTES.ERRORS.DUPLICATE_LINE',
  SALES_CREDIT_NOTE_QUANTITY_EXCEEDS_SOURCE: 'SALES.CREDIT_NOTES.ERRORS.QUANTITY_EXCEEDS_SOURCE',
  SALES_CREDIT_NOTE_CUMULATIVE_QUANTITY_EXCEEDED: 'SALES.CREDIT_NOTES.ERRORS.QUANTITY_EXCEEDS_REMAINING',
  SALES_CREDIT_NOTE_SOURCE_LINE_NOT_FOUND: 'SALES.CREDIT_NOTES.ERRORS.SOURCE_LINE_NOT_FOUND',
  MAX_CREDIT_NOTE_LINES_EXCEEDED: 'SALES.CREDIT_NOTES.ERRORS.MAX_LINES'
};

function creditLineErrorKey(code: string | null, edit: boolean): string {
  return code ? CREDIT_LINE_ERROR_KEYS[code] ?? (edit ? 'SALES.CREDIT_NOTES.ERRORS.LINE_UPDATE_FAILED' : 'SALES.CREDIT_NOTES.ERRORS.LINE_ADD_FAILED')
    : edit ? 'SALES.CREDIT_NOTES.ERRORS.LINE_UPDATE_FAILED' : 'SALES.CREDIT_NOTES.ERRORS.LINE_ADD_FAILED';
}

function zodValidator(schema: ZodType): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    schema.safeParse(control.value).success ? null : { exactQuantity: true };
}
