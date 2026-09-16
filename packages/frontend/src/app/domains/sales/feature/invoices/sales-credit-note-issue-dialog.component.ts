import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  SalesInvoiceIssueDateSchema,
  type IssueSalesCreditNoteRequest,
  type IssueSalesCreditNoteResponse,
  type SalesDraftCreditNote,
  type SalesInvoiceReceivable
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { safeMessageFromError, type ApiMutationResult } from '../../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { SalesPaymentsApi } from '../../data-access/sales-payments.api';
import { freezeSalesCreditNoteIssue, isAmbiguousSalesCreditNoteFailure } from '../../utils/sales-credit-note-attempt';
import { formatExactMoney } from '../../utils/exact-money-display';
import { localCalendarDate } from '../../utils/sales-invoice-dates';
import { salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';

export interface SalesCreditNoteIssueDialogData {
  creditNote: SalesDraftCreditNote;
  receivable: SalesInvoiceReceivable;
}

export type SalesCreditNoteIssueDialogResult =
  | { kind: 'issued'; result: ApiMutationResult<IssueSalesCreditNoteResponse> }
  | { kind: 'refresh'; reason: 'credit-note-conflict' | 'settlement-conflict' | 'exceeds-balance' | 'already-settled' | 'idempotency-reused' };

@Component({
  selector: 'liass-sales-credit-note-issue-dialog',
  host: { class: 'block' },
  imports: [LiassButtonComponent, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, TranslocoModule],
  templateUrl: './sales-credit-note-issue-dialog.component.html'
})
export class SalesCreditNoteIssueDialogComponent {
  protected readonly data = inject<SalesCreditNoteIssueDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(SalesCreditNotesApi);
  private readonly paymentsApi = inject(SalesPaymentsApi);
  private readonly dialogRef = inject<MatDialogRef<SalesCreditNoteIssueDialogComponent, SalesCreditNoteIssueDialogResult | null>>(MatDialogRef);
  private readonly transloco = inject(TranslocoService);

  protected readonly issueDate = signal(localCalendarDate());
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly ambiguous = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly validDate = computed(() => SalesInvoiceIssueDateSchema.safeParse(this.issueDate()).success);
  protected readonly attempt = signal<IssueSalesCreditNoteRequest | null>(null);

  protected money(value: string): string {
    return formatExactMoney(value, this.data.creditNote.currency, this.transloco.getActiveLang());
  }

  protected updateIssueDate(event: Event): void {
    if (this.attempt()) return;
    this.issueDate.set((event.target as HTMLInputElement).value);
    this.submitted.set(false);
    this.errorMessage.set(null);
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    this.submitted.set(true);
    if (!this.validDate()) return;

    let request = this.attempt();
    if (!request) {
      request = freezeSalesCreditNoteIssue({
        expectedCreditNoteVersion: this.data.creditNote.version,
        expectedReceivableVersion: this.data.receivable.version,
        issueDate: this.issueDate()
      });
      this.attempt.set(request);
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const result = await this.api.issue(
        this.data.creditNote.originalInvoiceId,
        this.data.creditNote.id,
        request
      );
      this.dialogRef.close({ kind: 'issued', result });
    } catch (error) {
      await this.handleFailure(error);
    } finally { this.submitting.set(false); }
  }

  private async handleFailure(error: unknown): Promise<void> {
    if (isAmbiguousSalesCreditNoteFailure(error)) {
      this.ambiguous.set(true);
      this.errorMessage.set(this.transloco.translate('SALES.CREDIT_NOTES.ISSUE.ERRORS.AMBIGUOUS'));
      await this.resolveAmbiguousResult();
      return;
    }

    const reason = issueRefreshReason(salesInvoiceErrorCode(error));
    if (reason) {
      this.dialogRef.close({ kind: 'refresh', reason });
      return;
    }

    this.errorMessage.set(
      safeMessageFromError(error) ?? this.transloco.translate('SALES.CREDIT_NOTES.ISSUE.ERRORS.FAILED')
    );
  }

  private async resolveAmbiguousResult(): Promise<void> {
    try {
      const creditNote = await this.api.get(this.data.creditNote.originalInvoiceId, this.data.creditNote.id);
      if (creditNote.status !== 'ISSUED') return;
      const receivable = await this.paymentsApi.getReceivable(this.data.creditNote.originalInvoiceId);
      this.dialogRef.close({ kind: 'issued', result: { data: { creditNote, receivable }, message: null } });
    } catch {
      // The frozen request remains available for an explicit idempotent retry.
    }
  }
}

function issueRefreshReason(code: string | null): Extract<SalesCreditNoteIssueDialogResult, { kind: 'refresh' }>['reason'] | null {
  const reasons: Record<string, Extract<SalesCreditNoteIssueDialogResult, { kind: 'refresh' }>['reason']> = {
    SALES_CREDIT_NOTE_VERSION_CONFLICT: 'credit-note-conflict',
    SALES_CREDIT_NOTE_ISSUE_CONCURRENCY_CONFLICT: 'credit-note-conflict',
    SALES_RECEIVABLE_VERSION_CONFLICT: 'settlement-conflict',
    SALES_CREDIT_NOTE_EXCEEDS_BALANCE: 'exceeds-balance',
    SALES_INVOICE_ALREADY_SETTLED: 'already-settled',
    SALES_CREDIT_NOTE_IDEMPOTENCY_KEY_REUSED: 'idempotency-reused'
  };
  return code ? reasons[code] ?? null : null;
}
