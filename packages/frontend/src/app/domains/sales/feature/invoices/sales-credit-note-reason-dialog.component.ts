import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { SalesCreditNote } from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';

export interface SalesCreditNoteReasonDialogData {
  invoiceId: string;
  creditNote: SalesCreditNote;
}

export type SalesCreditNoteReasonDialogResult =
  | { kind: 'updated'; creditNote: SalesCreditNote }
  | { kind: 'conflict' };

@Component({
  selector: 'liass-sales-credit-note-reason-dialog',
  host: { class: 'block' },
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, TranslocoModule],
  templateUrl: './sales-credit-note-reason-dialog.component.html'
})
export class SalesCreditNoteReasonDialogComponent {
  protected readonly data = inject<SalesCreditNoteReasonDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesCreditNotesApi);
  private readonly dialogRef = inject<MatDialogRef<SalesCreditNoteReasonDialogComponent, SalesCreditNoteReasonDialogResult | null>>(MatDialogRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly notification = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    reason: [this.data.creditNote.reason ?? '', Validators.maxLength(1000)]
  });

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting() || this.data.creditNote.status !== 'DRAFT') {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const reason = this.form.controls.reason.value.trim();
      const result = await this.api.update(this.data.invoiceId, this.data.creditNote.id, {
        expectedVersion: this.data.creditNote.version,
        reason: reason || null
      });
      this.notification.success(result.message ?? this.transloco.translate('SALES.CREDIT_NOTES.NOTIFICATIONS.UPDATED'));
      this.dialogRef.close({ kind: 'updated', creditNote: result.data });
    } catch (error) {
      if (salesInvoiceErrorCode(error) === 'SALES_CREDIT_NOTE_VERSION_CONFLICT') {
        this.dialogRef.close({ kind: 'conflict' });
        return;
      }
      const message = safeMessageFromError(error) ?? this.transloco.translate('SALES.CREDIT_NOTES.ERRORS.UPDATE_FAILED');
      this.errorMessage.set(message ?? 'SALES.CREDIT_NOTES.ERRORS.UPDATE_FAILED');
      this.notification.error(message ?? 'SALES.CREDIT_NOTES.ERRORS.UPDATE_FAILED');
    } finally { this.submitting.set(false); }
  }
}
