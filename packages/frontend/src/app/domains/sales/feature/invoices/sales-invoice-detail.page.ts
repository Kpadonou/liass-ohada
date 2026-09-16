import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, type Type } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import type {
  SalesDraftInvoice,
  SalesInvoice,
  SalesInvoiceLine,
  SalesIssuedInvoice,
  SalesCreditNoteSummary,
  SalesPaymentMethod,
  SalesReceivableStatus
} from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { take } from 'rxjs';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassConfirmationDialogComponent } from '../../../../shared/ui/confirmation-dialog/confirmation-dialog.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesCreditNotesApi } from '../../data-access/sales-credit-notes.api';
import { SalesCreditNotesQueries } from '../../data-access/sales-credit-notes.queries';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { SalesPaymentsQueries } from '../../data-access/sales-payments.queries';
import { formatExactMoney } from '../../utils/exact-money-display';
import { formatInvoiceDate, formatInvoiceTimestamp } from '../../utils/sales-invoice-dates';
import { isSalesInvoiceVersionConflict, salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';
import { hasPositiveExactAmount } from '../../utils/sales-payment-attempt';
import { SalesInvoiceCurrencyDialogComponent } from './sales-invoice-currency-dialog.component';
import { SalesInvoiceCustomerDialogComponent } from './sales-invoice-customer-dialog.component';
import { SalesInvoiceLineDialogComponent } from './sales-invoice-line-dialog.component';
import {
  SalesInvoiceIssueDialogComponent,
  type SalesInvoiceIssueDialogResult
} from './sales-invoice-issue-dialog.component';
import {
  SalesPaymentDialogComponent,
  type SalesPaymentDialogData,
  type SalesPaymentDialogResult
} from './sales-payment-dialog.component';

const PAYMENT_PAGE_SIZE = 25;
const CREDIT_NOTE_PAGE_SIZE = 25;

@Component({
  selector: 'liass-sales-invoice-detail-page',
  host: { class: 'block' },
  imports: [LiassButtonComponent, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent, LiassStatusChipComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './sales-invoice-detail.page.html'
})
export class SalesInvoiceDetailPage {
  private readonly api = inject(SalesInvoicesApi);
  private readonly creditNotesApi = inject(SalesCreditNotesApi);
  private readonly creditNoteQueries = inject(SalesCreditNotesQueries);
  protected readonly capabilities = inject(SalesCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly productAccess = inject(ProductAccessState);
  private readonly queries = inject(SalesInvoicesQueries);
  private readonly paymentQueries = inject(SalesPaymentsQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly invoiceId = this.route.snapshot.paramMap.get('invoiceId') ?? '';
  protected readonly removingLineId = signal<string | null>(null);
  protected readonly generatingDocument = signal(false);
  protected readonly documentAction = signal<'open' | 'download' | 'print' | null>(null);
  protected readonly paymentCursor = signal<string | undefined>(undefined);
  protected readonly paymentCursorHistory = signal<string[]>([]);
  protected readonly creditNoteCursor = signal<string | undefined>(undefined);
  protected readonly creditNoteCursorHistory = signal<string[]>([]);
  protected readonly creatingCreditNote = signal(false);
  protected readonly availability = computed(() => this.productAccess.availability('SALES'));
  protected readonly canLoad = computed(() => this.availability() === 'AVAILABLE' && this.capabilities.canRead());
  protected readonly invoiceQuery = injectQuery(() => this.queries.detail(this.invoiceId, this.canLoad()));
  protected readonly invoice = computed(() => this.invoiceQuery.data());
  protected readonly settlementEnabled = computed(() =>
    this.canLoad() && this.invoice()?.status === 'ISSUED'
  );
  protected readonly receivableQuery = injectQuery(() =>
    this.paymentQueries.receivable(this.invoiceId, this.settlementEnabled())
  );
  protected readonly receivable = computed(() => this.receivableQuery.data());
  protected readonly paymentsQuery = injectQuery(() =>
    this.paymentQueries.payments(
      this.invoiceId,
      { limit: PAYMENT_PAGE_SIZE, cursor: this.paymentCursor() },
      this.settlementEnabled()
    )
  );
  protected readonly payments = computed(() => this.paymentsQuery.data()?.items ?? []);
  protected readonly hasPreviousPayments = computed(() => this.paymentCursorHistory().length > 0);
  protected readonly hasNextPayments = computed(() => !!this.paymentsQuery.data()?.nextCursor);
  protected readonly canRecordPayment = computed(() => {
    const receivable = this.receivable();
    return this.settlementEnabled() && this.capabilities.canWrite() && !!receivable &&
      receivable.status !== 'SETTLED' && hasPositiveExactAmount(receivable.balanceDue);
  });
  protected readonly creditNotesQuery = injectQuery(() =>
    this.creditNoteQueries.list(
      this.invoiceId,
      { limit: CREDIT_NOTE_PAGE_SIZE, cursor: this.creditNoteCursor() },
      this.settlementEnabled()
    )
  );
  protected readonly creditNotes = computed(() => this.creditNotesQuery.data()?.items ?? []);
  protected readonly hasPreviousCreditNotes = computed(() => this.creditNoteCursorHistory().length > 0);
  protected readonly hasNextCreditNotes = computed(() => !!this.creditNotesQuery.data()?.nextCursor);
  protected readonly canCreateCreditNote = computed(() => {
    const receivable = this.receivable();
    return this.settlementEnabled() && this.capabilities.canWrite() && !!receivable &&
      receivable.status !== 'SETTLED' && hasPositiveExactAmount(receivable.balanceDue);
  });
  protected readonly documentQuery = injectQuery(() =>
    this.queries.document(
      this.invoiceId,
      this.canLoad() && this.invoice()?.status === 'ISSUED'
    )
  );
  protected readonly documentAbsent = computed(() => {
    const error = this.documentQuery.error();
    return this.invoice()?.status === 'ISSUED' &&
      this.documentQuery.isError() &&
      error instanceof HttpErrorResponse &&
      error.status === 404;
  });
  protected readonly documentErrorMessage = computed(() =>
    safeMessageFromError(this.documentQuery.error()) ??
    this.transloco.translate('SALES.INVOICES.DOCUMENT.ERRORS.UNAVAILABLE')
  );

  protected money(value: string, currency: string): string { return formatExactMoney(value, currency, this.transloco.getActiveLang()); }
  protected invoiceDate(value: string): string { return formatInvoiceDate(value, this.transloco.getActiveLang()); }
  protected invoiceTimestamp(value: string): string { return formatInvoiceTimestamp(value, this.transloco.getActiveLang()); }
  protected reference(invoice: SalesInvoice): string { return invoice.id.slice(-8).toUpperCase(); }
  protected address(invoice: SalesInvoice): string {
    const value = invoice.customerSnapshot?.billingAddress;
    return value ? [value.line1, value.line2, value.city, value.postalCode, value.country].filter(Boolean).join(', ') : '';
  }

  protected back(): void { void this.router.navigate(['/sales/invoices']); }
  protected retry(): void { void this.invoiceQuery.refetch(); }
  protected retryDocument(): void { void this.documentQuery.refetch(); }
  protected retryReceivable(): void { void this.receivableQuery.refetch(); }
  protected retryPayments(): void { void this.paymentsQuery.refetch(); }
  protected retryCreditNotes(): void { void this.creditNotesQuery.refetch(); }

  protected creditNoteStatusKey(status: SalesCreditNoteSummary['status']): string {
    return `SALES.CREDIT_NOTES.STATUS.${status}`;
  }

  protected creditNoteTitle(note: SalesCreditNoteSummary): string {
    return note.status === 'ISSUED'
      ? this.transloco.translate('SALES.CREDIT_NOTES.NUMBER', { number: note.creditNoteNumber })
      : this.transloco.translate('SALES.CREDIT_NOTES.DRAFT_TITLE');
  }

  protected openCreditNote(note: SalesCreditNoteSummary): void {
    void this.router.navigate(['/sales/invoices', this.invoiceId, 'credit-notes', note.id]);
  }

  protected async createCreditNote(): Promise<void> {
    if (!this.canCreateCreditNote() || this.creatingCreditNote()) return;
    this.creatingCreditNote.set(true);
    try {
      const result = await this.creditNotesApi.create(this.invoiceId);
      this.queryClient.setQueryData(
        this.creditNoteQueries.detailKey(this.invoiceId, result.data.id), result.data
      );
      await this.queryClient.invalidateQueries({ queryKey: this.creditNoteQueries.rootKey(this.invoiceId) });
      this.notification.success(result.message ?? this.transloco.translate('SALES.CREDIT_NOTES.NOTIFICATIONS.CREATED'));
      await this.router.navigate(['/sales/invoices', this.invoiceId, 'credit-notes', result.data.id]);
    } catch (error) {
      const key = salesInvoiceErrorCode(error) === 'SALES_INVOICE_ALREADY_SETTLED'
        ? 'SALES.CREDIT_NOTES.ERRORS.ALREADY_SETTLED'
        : 'SALES.CREDIT_NOTES.ERRORS.CREATE_FAILED';
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate(key));
      if (salesInvoiceErrorCode(error) === 'SALES_INVOICE_ALREADY_SETTLED') await this.receivableQuery.refetch();
    } finally { this.creatingCreditNote.set(false); }
  }

  protected nextCreditNotesPage(): void {
    const next = this.creditNotesQuery.data()?.nextCursor;
    if (!next) return;
    this.creditNoteCursorHistory.update((history) => [...history, this.creditNoteCursor() ?? '']);
    this.creditNoteCursor.set(next);
  }

  protected previousCreditNotesPage(): void {
    const history = [...this.creditNoteCursorHistory()];
    const previous = history.pop();
    this.creditNoteCursorHistory.set(history);
    this.creditNoteCursor.set(previous || undefined);
  }

  protected settlementStatusKey(status: SalesReceivableStatus): string {
    return `SALES.INVOICES.SETTLEMENT.STATUS.${status}`;
  }

  protected settlementTone(status: SalesReceivableStatus): 'warning' | 'info' | 'success' {
    return status === 'SETTLED' ? 'success' : status === 'PARTIALLY_SETTLED' ? 'info' : 'warning';
  }

  protected paymentMethodKey(method: SalesPaymentMethod): string {
    return `SALES.INVOICES.SETTLEMENT.METHODS.${method}`;
  }

  protected nextPaymentsPage(): void {
    const next = this.paymentsQuery.data()?.nextCursor;
    if (!next) return;
    this.paymentCursorHistory.update((history) => [...history, this.paymentCursor() ?? '']);
    this.paymentCursor.set(next);
  }

  protected previousPaymentsPage(): void {
    const history = [...this.paymentCursorHistory()];
    const previous = history.pop();
    this.paymentCursorHistory.set(history);
    this.paymentCursor.set(previous || undefined);
  }

  protected openPayment(): void {
    const invoice = this.invoice();
    const receivable = this.receivable();
    if (!invoice || invoice.status !== 'ISSUED' || !receivable || !this.canRecordPayment()) return;

    this.dialog.open<
      SalesPaymentDialogComponent,
      SalesPaymentDialogData,
      SalesPaymentDialogResult | null
    >(SalesPaymentDialogComponent, {
      data: this.paymentDialogData(invoice),
      disableClose: true,
      panelClass: 'liass-dialog-panel',
      width: '680px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100dvh - 24px)',
      autoFocus: 'first-tabbable'
    }).afterClosed().pipe(take(1)).subscribe((result) => {
      if (result) void this.acceptPayment(result);
    });
  }

  protected async generateDocument(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'ISSUED' || !this.capabilities.canWrite() || this.generatingDocument()) return;

    this.generatingDocument.set(true);
    try {
      const result = await this.api.generateDocument(invoice.id);
      this.queryClient.setQueryData(this.queries.documentKey(invoice.id), result.data);
      this.notification.success(
        result.message ?? this.transloco.translate('SALES.INVOICES.DOCUMENT.NOTIFICATIONS.READY')
      );
    } catch (error) {
      if (salesInvoiceErrorCode(error) === 'INVOICE_DOCUMENT_REQUIRES_ISSUED') {
        await this.refreshAuthoritative();
      }
      this.notification.error(
        safeMessageFromError(error) ?? this.transloco.translate('SALES.INVOICES.DOCUMENT.ERRORS.GENERATION_FAILED')
      );
    } finally {
      this.generatingDocument.set(false);
    }
  }

  protected openDocument(): void { void this.useDocumentUrl('open'); }
  protected downloadDocument(): void { void this.useDocumentUrl('download'); }
  protected printDocument(): void { void this.useDocumentUrl('print'); }

  protected openCustomer(): void {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'DRAFT' || !this.capabilities.canWrite()) return;
    this.openMutationDialog(SalesInvoiceCustomerDialogComponent, invoice, '720px');
  }

  protected openCurrency(): void {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'DRAFT' || !this.capabilities.canWrite() || invoice.lineCount > 0) return;
    this.openMutationDialog(SalesInvoiceCurrencyDialogComponent, invoice, '460px');
  }

  protected openAddLine(): void {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'DRAFT' || !this.capabilities.canWrite() || invoice.lineCount >= 100) return;
    this.openMutationDialog(SalesInvoiceLineDialogComponent, { invoice }, '820px');
  }

  protected openEditLine(line: SalesInvoiceLine): void {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'DRAFT' || !this.capabilities.canWrite()) return;
    this.openMutationDialog(SalesInvoiceLineDialogComponent, { invoice, line }, '760px');
  }

  protected confirmRemove(line: SalesInvoiceLine): void {
    if (this.invoice()?.status !== 'DRAFT' || !this.capabilities.canWrite()) return;
    this.dialog.open(LiassConfirmationDialogComponent, {
      data: { titleKey: 'SALES.INVOICES.REMOVE_LINE.TITLE', descriptionKey: 'SALES.INVOICES.REMOVE_LINE.DESCRIPTION', descriptionParams: { description: line.description }, confirmKey: 'SALES.INVOICES.ACTIONS.REMOVE_LINE', cancelKey: 'COMMON.ACTIONS.CANCEL', tone: 'danger' },
      disableClose: true, panelClass: 'liass-dialog-panel', width: '500px', maxWidth: 'calc(100vw - 24px)'
    }).afterClosed().pipe(take(1)).subscribe((confirmed) => { if (confirmed) void this.removeLine(line); });
  }

  protected openIssue(): void {
    const invoice = this.invoice();
    if (
      !invoice ||
      invoice.status !== 'DRAFT' ||
      invoice.lineCount === 0 ||
      !this.capabilities.canWrite()
    ) return;

    this.dialog.open<
      SalesInvoiceIssueDialogComponent,
      SalesDraftInvoice,
      SalesInvoiceIssueDialogResult | null
    >(SalesInvoiceIssueDialogComponent, {
      data: invoice,
      disableClose: true,
      panelClass: 'liass-dialog-panel',
      width: '680px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100dvh - 24px)',
      autoFocus: 'first-tabbable'
    }).afterClosed().pipe(take(1)).subscribe((result) => {
      if (result) void this.handleIssueResult(result);
    });
  }

  private openMutationDialog(component: Type<unknown>, data: unknown, width: string): void {
    this.dialog.open(component, { data, panelClass: 'liass-dialog-panel', width, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)' })
      .afterClosed().pipe(take(1)).subscribe((invoice: SalesInvoice | null | undefined) => { if (invoice) void this.acceptInvoice(invoice); });
  }

  private async removeLine(line: SalesInvoiceLine): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'DRAFT') return;
    this.removingLineId.set(line.id);
    try {
      const result = await this.api.removeLine(invoice.id, line.id, invoice.version);
      await this.acceptInvoice(result.data);
      this.notification.success(result.message ?? this.transloco.translate('SALES.INVOICES.NOTIFICATIONS.LINE_REMOVED'));
    } catch (error) {
      const key = isSalesInvoiceVersionConflict(error) ? 'SALES.INVOICES.ERRORS.CONFLICT' : 'SALES.INVOICES.ERRORS.LINE_REMOVE_FAILED';
      const message = isSalesInvoiceVersionConflict(error)
        ? this.transloco.translate<string>(key) ?? key
        : safeMessageFromError(error) ?? this.transloco.translate<string>(key) ?? key;
      this.notification.error(message);
      if (isSalesInvoiceVersionConflict(error)) await this.refreshAuthoritative();
    } finally { this.removingLineId.set(null); }
  }

  private async useDocumentUrl(action: 'open' | 'download' | 'print'): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'ISSUED' || this.documentAction()) return;

    const popup = action === 'download' ? null : this.openDocumentWindow();
    this.documentAction.set(action);
    try {
      const { url } = await this.api.createDocumentDownloadUrl(invoice.id);
      if (action === 'download') {
        const anchor = globalThis.document.createElement('a');
        anchor.href = url;
        anchor.download = `facture-${invoice.invoiceNumber}.pdf`;
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
        safeMessageFromError(error) ?? this.transloco.translate('SALES.INVOICES.DOCUMENT.ERRORS.SECURE_LINK_FAILED')
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

  private async handleIssueResult(result: SalesInvoiceIssueDialogResult): Promise<void> {
    if (result.kind === 'issued') {
      await this.acceptInvoice(result.invoice);
      this.notification.success(
        result.message ??
          this.transloco.translate('SALES.INVOICES.NOTIFICATIONS.ISSUED', {
            invoiceNumber: result.invoice.invoiceNumber
          })
      );
      return;
    }

    await this.refreshAuthoritative();
    const key = {
      'version-conflict': 'SALES.INVOICES.ISSUE.ERRORS.VERSION_CONFLICT',
      'already-issued': 'SALES.INVOICES.ISSUE.ERRORS.ALREADY_ISSUED',
      'idempotency-reused': 'SALES.INVOICES.ISSUE.ERRORS.IDEMPOTENCY_REUSED',
      'no-lines': 'SALES.INVOICES.ISSUE.ERRORS.NO_LINES'
    }[result.reason];
    const message = this.transloco.translate(key);
    if (result.reason === 'already-issued') this.notification.info(message);
    else if (result.reason === 'version-conflict' || result.reason === 'no-lines') this.notification.warn(message);
    else this.notification.error(message);
  }

  private async acceptInvoice(invoice: SalesInvoice): Promise<void> {
    this.queryClient.setQueryData(this.queries.detailKey(invoice.id), invoice);
    await this.queryClient.invalidateQueries({ queryKey: this.queries.listRootKey() });
  }

  private paymentDialogData(invoice: SalesIssuedInvoice): SalesPaymentDialogData {
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      receivable: this.receivable()!
    };
  }

  private async acceptPayment(result: SalesPaymentDialogResult): Promise<void> {
    this.queryClient.setQueryData(
      this.paymentQueries.receivableKey(this.invoiceId),
      result.data.receivable
    );
    await this.queryClient.invalidateQueries({
      queryKey: this.paymentQueries.paymentsRootKey(this.invoiceId)
    });
    this.notification.success(
      result.message ?? this.transloco.translate('SALES.INVOICES.SETTLEMENT.NOTIFICATIONS.RECORDED')
    );
  }

  private async refreshAuthoritative(): Promise<void> {
    await Promise.all([
      this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(this.invoiceId) }),
      this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() })
    ]);
  }
}
