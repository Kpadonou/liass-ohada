import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, type Type } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import type { SalesCreditNote, SalesCreditNoteLine } from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassConfirmationDialogComponent } from '../../../../shared/ui/confirmation-dialog/confirmation-dialog.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { SalesCreditNotesQueries } from '../../data-access/sales-credit-notes.queries';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesPaymentsQueries } from '../../data-access/sales-payments.queries';
import { formatExactMoney } from '../../utils/exact-money-display';
import { formatInvoiceDate, formatInvoiceTimestamp } from '../../utils/sales-invoice-dates';
import { hasPositiveExactAmount } from '../../utils/sales-payment-attempt';
import { salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';
import { SalesCreditNoteIssueDialogComponent, type SalesCreditNoteIssueDialogData, type SalesCreditNoteIssueDialogResult } from './sales-credit-note-issue-dialog.component';
import { SalesCreditNoteLineDialogComponent, type SalesCreditNoteLineDialogData, type SalesCreditNoteLineDialogResult } from './sales-credit-note-line-dialog.component';
import { SalesCreditNoteReasonDialogComponent, type SalesCreditNoteReasonDialogData, type SalesCreditNoteReasonDialogResult } from './sales-credit-note-reason-dialog.component';

@Component({
  selector: 'liass-sales-credit-note-detail-page',
  host: { class: 'block' },
  imports: [LiassButtonComponent, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent, LiassStatusChipComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './sales-credit-note-detail.page.html'
})
export class SalesCreditNoteDetailPage {
  protected readonly capabilities = inject(SalesCapabilities);
  private readonly api = inject(SalesCreditNotesApi);
  private readonly creditNoteQueries = inject(SalesCreditNotesQueries);
  private readonly dialog = inject(MatDialog);
  private readonly invoiceQueries = inject(SalesInvoicesQueries);
  private readonly notification = inject(NotificationService);
  private readonly paymentQueries = inject(SalesPaymentsQueries);
  private readonly productAccess = inject(ProductAccessState);
  private readonly queryClient = inject(QueryClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly invoiceId = this.route.snapshot.paramMap.get('invoiceId') ?? '';
  protected readonly creditNoteId = this.route.snapshot.paramMap.get('creditNoteId') ?? '';
  protected readonly removingLineId = signal<string | null>(null);
  protected readonly generatingDocument = signal(false);
  protected readonly documentAction = signal<'open' | 'download' | 'print' | null>(null);
  protected readonly canLoad = computed(() =>
    this.productAccess.availability('SALES') === 'AVAILABLE' && this.capabilities.canRead()
  );
  protected readonly invoiceQuery = injectQuery(() => this.invoiceQueries.detail(this.invoiceId, this.canLoad()));
  protected readonly creditNoteQuery = injectQuery(() =>
    this.creditNoteQueries.detail(this.invoiceId, this.creditNoteId, this.canLoad())
  );
  protected readonly receivableQuery = injectQuery(() =>
    this.paymentQueries.receivable(this.invoiceId, this.canLoad() && this.invoiceQuery.data()?.status === 'ISSUED')
  );
  protected readonly invoice = computed(() => {
    const invoice = this.invoiceQuery.data();
    return invoice?.status === 'ISSUED' ? invoice : undefined;
  });
  protected readonly creditNote = computed(() => this.creditNoteQuery.data());
  protected readonly documentQuery = injectQuery(() =>
    this.creditNoteQueries.document(
      this.invoiceId,
      this.creditNoteId,
      this.canLoad() && this.creditNote()?.status === 'ISSUED'
    )
  );
  protected readonly documentAbsent = computed(() => {
    const error = this.documentQuery.error();
    return this.creditNote()?.status === 'ISSUED' && this.documentQuery.isError() &&
      error instanceof HttpErrorResponse && error.status === 404;
  });
  protected readonly documentErrorMessage = computed(() => {
    const key = salesInvoiceErrorCode(this.documentQuery.error()) === 'SALES_CREDIT_NOTE_DOCUMENT_INTEGRITY_ERROR'
      ? 'SALES.CREDIT_NOTES.DOCUMENT.ERRORS.INTEGRITY'
      : 'SALES.CREDIT_NOTES.DOCUMENT.ERRORS.UNAVAILABLE';
    return safeMessageFromError(this.documentQuery.error()) ?? this.transloco.translate(key);
  });
  protected readonly receivable = computed(() => this.receivableQuery.data());
  protected readonly editable = computed(() =>
    this.creditNote()?.status === 'DRAFT' && this.capabilities.canWrite()
  );
  protected readonly canIssue = computed(() => {
    const note = this.creditNote();
    const receivable = this.receivable();
    return note?.status === 'DRAFT' && this.capabilities.canWrite() && note.lineCount > 0 &&
      !!note.reason?.trim() && !!receivable && receivable.status !== 'SETTLED' &&
      hasPositiveExactAmount(receivable.balanceDue);
  });

  protected money(value: string, currency: string): string {
    return formatExactMoney(value, currency, this.transloco.getActiveLang());
  }
  protected date(value: string): string { return formatInvoiceDate(value, this.transloco.getActiveLang()); }
  protected timestamp(value: string): string { return formatInvoiceTimestamp(value, this.transloco.getActiveLang()); }
  protected statusKey(status: SalesCreditNote['status']): string { return `SALES.CREDIT_NOTES.STATUS.${status}`; }
  protected statusTone(status: SalesCreditNote['status']): 'neutral' | 'success' {
    return status === 'ISSUED' ? 'success' : 'neutral';
  }
  protected title(note: SalesCreditNote): string {
    return note.status === 'ISSUED'
      ? this.transloco.translate('SALES.CREDIT_NOTES.NUMBER', { number: note.creditNoteNumber })
      : this.transloco.translate('SALES.CREDIT_NOTES.DRAFT_TITLE');
  }

  protected back(): void { void this.router.navigate(['/sales/invoices', this.invoiceId]); }
  protected retry(): void { void Promise.all([this.creditNoteQuery.refetch(), this.invoiceQuery.refetch(), this.receivableQuery.refetch()]); }
  protected retryDocument(): void { void this.documentQuery.refetch(); }

  protected async generateDocument(): Promise<void> {
    const note = this.creditNote();
    if (!note || note.status !== 'ISSUED' || !this.capabilities.canWrite() || this.generatingDocument()) return;

    this.generatingDocument.set(true);
    try {
      const result = await this.api.generateDocument(this.invoiceId, note.id);
      this.queryClient.setQueryData(this.creditNoteQueries.documentKey(this.invoiceId, note.id), result.data);
      this.notification.success(
        result.message ?? this.transloco.translate('SALES.CREDIT_NOTES.DOCUMENT.NOTIFICATIONS.READY')
      );
    } catch (error) {
      const code = salesInvoiceErrorCode(error);
      if (code === 'CREDIT_NOTE_DOCUMENT_REQUIRES_ISSUED' || code === 'SALES_CREDIT_NOTE_NOT_FOUND') {
        await this.creditNoteQuery.refetch();
      }
      this.notification.error(
        safeMessageFromError(error) ?? this.transloco.translate('SALES.CREDIT_NOTES.DOCUMENT.ERRORS.GENERATION_FAILED')
      );
    } finally {
      this.generatingDocument.set(false);
    }
  }

  protected openDocument(): void { void this.useDocumentUrl('open'); }
  protected downloadDocument(): void { void this.useDocumentUrl('download'); }
  protected printDocument(): void { void this.useDocumentUrl('print'); }

  protected openReason(): void {
    const note = this.creditNote();
    if (!note || !this.editable()) return;
    this.openMutationDialog<SalesCreditNoteReasonDialogResult, SalesCreditNoteReasonDialogData>(
      SalesCreditNoteReasonDialogComponent,
      { invoiceId: this.invoiceId, creditNote: note },
      '620px'
    );
  }

  protected openAddLine(): void {
    const note = this.creditNote();
    const invoice = this.invoice();
    if (!note || !invoice || !this.editable() || note.lineCount >= 100) return;
    this.openMutationDialog<SalesCreditNoteLineDialogResult, SalesCreditNoteLineDialogData>(
      SalesCreditNoteLineDialogComponent,
      { invoice, creditNote: note },
      '820px'
    );
  }

  protected openEditLine(line: SalesCreditNoteLine): void {
    const note = this.creditNote();
    const invoice = this.invoice();
    if (!note || !invoice || !this.editable()) return;
    this.openMutationDialog<SalesCreditNoteLineDialogResult, SalesCreditNoteLineDialogData>(
      SalesCreditNoteLineDialogComponent,
      { invoice, creditNote: note, line },
      '680px'
    );
  }

  protected confirmRemove(line: SalesCreditNoteLine): void {
    if (!this.editable()) return;
    this.dialog.open(LiassConfirmationDialogComponent, {
      data: {
        titleKey: 'SALES.CREDIT_NOTES.REMOVE_LINE.TITLE',
        descriptionKey: 'SALES.CREDIT_NOTES.REMOVE_LINE.DESCRIPTION',
        descriptionParams: { description: line.description },
        confirmKey: 'SALES.CREDIT_NOTES.ACTIONS.REMOVE_LINE',
        cancelKey: 'COMMON.ACTIONS.CANCEL', tone: 'danger'
      },
      disableClose: true, panelClass: 'liass-dialog-panel', width: '500px', maxWidth: 'calc(100vw - 24px)'
    }).afterClosed().pipe(take(1)).subscribe((confirmed) => { if (confirmed) void this.removeLine(line); });
  }

  protected openIssue(): void {
    const note = this.creditNote();
    const receivable = this.receivable();
    if (!note || note.status !== 'DRAFT' || !receivable || !this.canIssue()) return;
    this.dialog.open<SalesCreditNoteIssueDialogComponent, SalesCreditNoteIssueDialogData, SalesCreditNoteIssueDialogResult | null>(
      SalesCreditNoteIssueDialogComponent,
      {
        data: { creditNote: note, receivable }, disableClose: true,
        panelClass: 'liass-dialog-panel', width: '720px', maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100dvh - 24px)', autoFocus: 'first-tabbable'
      }
    ).afterClosed().pipe(take(1)).subscribe((result) => { if (result) void this.handleIssueResult(result); });
  }

  private openMutationDialog<TResult extends SalesCreditNoteReasonDialogResult | SalesCreditNoteLineDialogResult, TData>(
    component: Type<unknown>, data: TData, width: string
  ): void {
    this.dialog.open<unknown, TData, TResult | null>(component, {
      data, panelClass: 'liass-dialog-panel', width, maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100dvh - 24px)', autoFocus: 'first-tabbable'
    }).afterClosed().pipe(take(1)).subscribe((result) => {
      if (!result) return;
      if (result.kind === 'updated') void this.acceptCreditNote(result.creditNote);
      else void this.handleDraftConflict();
    });
  }

  private async removeLine(line: SalesCreditNoteLine): Promise<void> {
    const note = this.creditNote();
    if (!note || note.status !== 'DRAFT') return;
    this.removingLineId.set(line.id);
    try {
      const result = await this.api.removeLine(this.invoiceId, note.id, line.id, note.version);
      await this.acceptCreditNote(result.data);
      this.notification.success(result.message ?? this.transloco.translate('SALES.CREDIT_NOTES.NOTIFICATIONS.LINE_REMOVED'));
    } catch (error) {
      if (salesInvoiceErrorCode(error) === 'SALES_CREDIT_NOTE_VERSION_CONFLICT') {
        await this.handleDraftConflict();
      } else {
        this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('SALES.CREDIT_NOTES.ERRORS.LINE_REMOVE_FAILED'));
      }
    } finally { this.removingLineId.set(null); }
  }

  private async useDocumentUrl(action: 'open' | 'download' | 'print'): Promise<void> {
    const note = this.creditNote();
    if (!note || note.status !== 'ISSUED' || !this.documentQuery.data() || this.documentAction()) return;

    const popup = action === 'download' ? null : this.openDocumentWindow();
    this.documentAction.set(action);
    try {
      const { url } = await this.api.createDocumentDownloadUrl(this.invoiceId, note.id);
      if (action === 'download') {
        const anchor = globalThis.document.createElement('a');
        anchor.href = url;
        anchor.rel = 'noopener noreferrer';
        anchor.click();
      } else if (popup) {
        popup.location.href = url;
      } else {
        globalThis.window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      popup?.close();
      this.notification.error(
        safeMessageFromError(error) ?? this.transloco.translate('SALES.CREDIT_NOTES.DOCUMENT.ERRORS.SECURE_LINK_FAILED')
      );
    } finally {
      this.documentAction.set(null);
    }
  }

  private openDocumentWindow(): Window | null {
    const popup = globalThis.window.open('', '_blank');
    if (popup) popup.opener = null;
    return popup;
  }

  private async acceptCreditNote(note: SalesCreditNote): Promise<void> {
    this.queryClient.setQueryData(this.creditNoteQueries.detailKey(this.invoiceId, note.id), note);
    await this.queryClient.invalidateQueries({ queryKey: this.creditNoteQueries.rootKey(this.invoiceId) });
  }

  private async handleDraftConflict(): Promise<void> {
    await this.queryClient.invalidateQueries({ queryKey: this.creditNoteQueries.detailKey(this.invoiceId, this.creditNoteId) });
    this.notification.warn(this.transloco.translate('SALES.CREDIT_NOTES.ERRORS.VERSION_CONFLICT'));
  }

  private async handleIssueResult(result: SalesCreditNoteIssueDialogResult): Promise<void> {
    if (result.kind === 'issued') {
      this.queryClient.setQueryData(
        this.creditNoteQueries.detailKey(this.invoiceId, this.creditNoteId), result.result.data.creditNote
      );
      this.queryClient.setQueryData(this.paymentQueries.receivableKey(this.invoiceId), result.result.data.receivable);
      await this.queryClient.invalidateQueries({ queryKey: this.creditNoteQueries.rootKey(this.invoiceId) });
      this.notification.success(result.result.message ?? this.transloco.translate('SALES.CREDIT_NOTES.NOTIFICATIONS.ISSUED'));
      return;
    }

    const creditConflict = result.reason === 'credit-note-conflict';
    const settlementChanged = result.reason === 'settlement-conflict' || result.reason === 'exceeds-balance' || result.reason === 'already-settled';
    const work: Promise<unknown>[] = [
      this.queryClient.invalidateQueries({ queryKey: this.creditNoteQueries.rootKey(this.invoiceId) })
    ];
    if (creditConflict || result.reason === 'idempotency-reused') {
      work.push(this.queryClient.invalidateQueries({ queryKey: this.creditNoteQueries.detailKey(this.invoiceId, this.creditNoteId) }));
    }
    if (settlementChanged || result.reason === 'idempotency-reused') {
      work.push(this.queryClient.invalidateQueries({ queryKey: this.paymentQueries.receivableKey(this.invoiceId) }));
    }
    await Promise.all(work);
    const key = {
      'credit-note-conflict': 'SALES.CREDIT_NOTES.ISSUE.ERRORS.VERSION_CONFLICT',
      'settlement-conflict': 'SALES.CREDIT_NOTES.ISSUE.ERRORS.SETTLEMENT_CONFLICT',
      'exceeds-balance': 'SALES.CREDIT_NOTES.ISSUE.ERRORS.EXCEEDS_BALANCE',
      'already-settled': 'SALES.CREDIT_NOTES.ISSUE.ERRORS.ALREADY_SETTLED',
      'idempotency-reused': 'SALES.CREDIT_NOTES.ISSUE.ERRORS.IDEMPOTENCY_REUSED'
    }[result.reason];
    if (result.reason === 'already-settled') this.notification.info(this.transloco.translate(key));
    else if (result.reason === 'idempotency-reused') this.notification.error(this.transloco.translate(key));
    else this.notification.warn(this.transloco.translate(key));
  }
}
