import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  SalesInvoiceIssueDateSchema,
  type SalesDraftInvoice,
  type SalesIssuedInvoice
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { formatExactMoney } from '../../utils/exact-money-display';
import {
  createInvoiceIssueRequestId,
  localCalendarDate
} from '../../utils/sales-invoice-dates';
import {
  isAmbiguousSalesInvoiceIssueFailure,
  salesInvoiceErrorCode
} from '../../utils/sales-invoice-errors';

export type SalesInvoiceIssueDialogResult =
  | { kind: 'issued'; invoice: SalesIssuedInvoice; message: string | null }
  | {
      kind: 'refresh';
      reason: 'version-conflict' | 'already-issued' | 'idempotency-reused' | 'no-lines';
    };

@Component({
  selector: 'liass-sales-invoice-issue-dialog',
  host: { class: 'block' },
  imports: [
    LiassButtonComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslocoModule
  ],
  templateUrl: './sales-invoice-issue-dialog.component.html'
})
export class SalesInvoiceIssueDialogComponent {
  protected readonly invoice = inject<SalesDraftInvoice>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesInvoicesApi);
  private readonly dialogRef = inject<
    MatDialogRef<SalesInvoiceIssueDialogComponent, SalesInvoiceIssueDialogResult | null>
  >(MatDialogRef);
  private readonly transloco = inject(TranslocoService);

  protected readonly issueDate = signal(localCalendarDate());
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly attemptStarted = signal(false);
  protected readonly ambiguous = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly validDate = computed(() =>
    SalesInvoiceIssueDateSchema.safeParse(this.issueDate()).success
  );
  private readonly clientRequestId = createInvoiceIssueRequestId();

  protected money(value: string): string {
    return formatExactMoney(value, this.invoice.currency, this.transloco.getActiveLang());
  }

  protected updateIssueDate(event: Event): void {
    this.issueDate.set((event.target as HTMLInputElement).value);
    this.submitted.set(false);
    this.errorMessage.set(null);
  }

  protected cancel(): void {
    if (!this.submitting()) this.dialogRef.close(null);
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    this.submitted.set(true);
    if (!this.validDate()) return;

    this.submitting.set(true);
    this.attemptStarted.set(true);
    this.errorMessage.set(null);
    try {
      const result = await this.api.issueInvoice(this.invoice.id, {
        expectedVersion: this.invoice.version,
        clientRequestId: this.clientRequestId,
        issueDate: this.issueDate()
      });
      if (result.data.status !== 'ISSUED') {
        this.errorMessage.set(this.transloco.translate('SALES.INVOICES.ISSUE.ERRORS.FAILED'));
        return;
      }
      this.dialogRef.close({ kind: 'issued', invoice: result.data, message: result.message });
    } catch (error) {
      const code = salesInvoiceErrorCode(error);
      if (code === 'SALES_INVOICE_VERSION_CONFLICT') {
        this.dialogRef.close({ kind: 'refresh', reason: 'version-conflict' });
      } else if (code === 'SALES_INVOICE_ALREADY_ISSUED') {
        this.dialogRef.close({ kind: 'refresh', reason: 'already-issued' });
      } else if (code === 'SALES_INVOICE_IDEMPOTENCY_KEY_REUSED') {
        this.dialogRef.close({ kind: 'refresh', reason: 'idempotency-reused' });
      } else if (code === 'SALES_INVOICE_HAS_NO_LINES') {
        this.dialogRef.close({ kind: 'refresh', reason: 'no-lines' });
      } else {
        this.ambiguous.set(isAmbiguousSalesInvoiceIssueFailure(error));
        this.errorMessage.set(
          safeMessageFromError(error) ??
            this.transloco.translate(
              this.ambiguous()
                ? 'SALES.INVOICES.ISSUE.ERRORS.AMBIGUOUS'
                : 'SALES.INVOICES.ISSUE.ERRORS.FAILED'
            )
        );
        if (this.ambiguous()) await this.resolveAmbiguousResult();
      }
    } finally {
      this.submitting.set(false);
    }
  }

  private async resolveAmbiguousResult(): Promise<void> {
    try {
      const authoritative = await this.api.get(this.invoice.id);
      if (authoritative.status === 'ISSUED') {
        this.dialogRef.close({ kind: 'issued', invoice: authoritative, message: null });
      }
    } catch {
      // The same attempt remains available for an explicit retry.
    }
  }
}
