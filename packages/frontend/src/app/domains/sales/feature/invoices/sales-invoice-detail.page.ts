import { Component, computed, inject, signal, type Type } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import type { SalesDraftInvoice, SalesInvoice, SalesInvoiceLine } from '@liass-ohada/shared/sales';
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
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { formatExactMoney } from '../../utils/exact-money-display';
import { formatInvoiceDate, formatInvoiceTimestamp } from '../../utils/sales-invoice-dates';
import { isSalesInvoiceVersionConflict } from '../../utils/sales-invoice-errors';
import { SalesInvoiceCurrencyDialogComponent } from './sales-invoice-currency-dialog.component';
import { SalesInvoiceCustomerDialogComponent } from './sales-invoice-customer-dialog.component';
import { SalesInvoiceLineDialogComponent } from './sales-invoice-line-dialog.component';
import {
  SalesInvoiceIssueDialogComponent,
  type SalesInvoiceIssueDialogResult
} from './sales-invoice-issue-dialog.component';

@Component({
  selector: 'liass-sales-invoice-detail-page',
  host: { class: 'block' },
  imports: [LiassButtonComponent, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent, LiassStatusChipComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './sales-invoice-detail.page.html'
})
export class SalesInvoiceDetailPage {
  private readonly api = inject(SalesInvoicesApi);
  protected readonly capabilities = inject(SalesCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly productAccess = inject(ProductAccessState);
  private readonly queries = inject(SalesInvoicesQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly invoiceId = this.route.snapshot.paramMap.get('invoiceId') ?? '';
  protected readonly removingLineId = signal<string | null>(null);
  protected readonly availability = computed(() => this.productAccess.availability('SALES'));
  protected readonly canLoad = computed(() => this.availability() === 'AVAILABLE' && this.capabilities.canRead());
  protected readonly invoiceQuery = injectQuery(() => this.queries.detail(this.invoiceId, this.canLoad()));
  protected readonly invoice = computed(() => this.invoiceQuery.data());

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

  private async refreshAuthoritative(): Promise<void> {
    await Promise.all([
      this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(this.invoiceId) }),
      this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() })
    ]);
  }
}
