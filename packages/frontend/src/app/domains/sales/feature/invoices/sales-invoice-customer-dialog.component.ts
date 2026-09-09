import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import type { SalesCustomer, SalesInvoice } from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { SalesCustomersQueries } from '../../data-access/sales-customers.queries';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { isSalesInvoiceVersionConflict, salesInvoiceErrorCode } from '../../utils/sales-invoice-errors';

const PAGE_SIZE = 25;

@Component({
  selector: 'liass-sales-invoice-customer-dialog',
  imports: [LiassButtonComponent, LiassSkeletonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  templateUrl: './sales-invoice-customer-dialog.component.html'
})
export class SalesInvoiceCustomerDialogComponent {
  protected readonly invoice = inject<SalesInvoice>(MAT_DIALOG_DATA);
  private readonly customersQueries = inject(SalesCustomersQueries);
  private readonly dialogRef = inject<MatDialogRef<SalesInvoiceCustomerDialogComponent, SalesInvoice | null>>(MatDialogRef);
  private readonly invoicesApi = inject(SalesInvoicesApi);
  private readonly invoicesQueries = inject(SalesInvoicesQueries);
  private readonly notification = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<string[]>([]);
  protected readonly selectedId = signal<string | null>(this.invoice.customerId ?? null);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly customersQuery = injectQuery(() => this.customersQueries.list({ limit: PAGE_SIZE, cursor: this.cursor() }));
  protected readonly customers = computed(() => this.customersQuery.data()?.items ?? []);
  protected readonly hasPrevious = computed(() => this.cursorHistory().length > 0);
  protected readonly hasNext = computed(() => !!this.customersQuery.data()?.nextCursor);

  protected select(customer: SalesCustomer): void {
    if (customer.isActive && !this.submitting()) this.selectedId.set(customer.id);
  }

  protected nextPage(): void {
    const next = this.customersQuery.data()?.nextCursor;
    if (!next) return;
    this.cursorHistory.update((history) => [...history, this.cursor() ?? '']);
    this.cursor.set(next);
  }

  protected previousPage(): void {
    const history = [...this.cursorHistory()];
    const previous = history.pop();
    this.cursorHistory.set(history);
    this.cursor.set(previous || undefined);
  }

  protected async submit(clear = false): Promise<void> {
    const customerId = clear ? null : this.selectedId();
    if (!clear && !customerId) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      const result = await this.invoicesApi.update(this.invoice.id, {
        expectedVersion: this.invoice.version,
        customerId
      });
      this.notification.success(result.message ?? this.transloco.translate('SALES.INVOICES.NOTIFICATIONS.UPDATED'));
      this.dialogRef.close(result.data);
    } catch (error) {
      const key = this.errorKey(error);
      const knownDomainError = isSalesInvoiceVersionConflict(error)
        || salesInvoiceErrorCode(error) === 'SALES_CUSTOMER_INACTIVE'
        || salesInvoiceErrorCode(error) === 'SALES_CUSTOMER_NOT_FOUND';
      const message = knownDomainError
        ? this.transloco.translate<string>(key) ?? key
        : safeMessageFromError(error) ?? this.transloco.translate<string>(key) ?? key;
      this.errorMessage.set(message);
      this.notification.error(message);
      if (salesInvoiceErrorCode(error) === 'SALES_CUSTOMER_INACTIVE' || salesInvoiceErrorCode(error) === 'SALES_CUSTOMER_NOT_FOUND') {
        await this.queryClient.invalidateQueries({ queryKey: this.customersQueries.rootKey() });
      }
      if (isSalesInvoiceVersionConflict(error)) {
        await Promise.all([
          this.queryClient.invalidateQueries({ queryKey: this.invoicesQueries.detailKey(this.invoice.id) }),
          this.queryClient.invalidateQueries({ queryKey: this.invoicesQueries.rootKey() })
        ]);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(): void { if (!this.submitting()) this.dialogRef.close(null); }

  private errorKey(error: unknown): string {
    if (isSalesInvoiceVersionConflict(error)) return 'SALES.INVOICES.ERRORS.CONFLICT';
    if (salesInvoiceErrorCode(error) === 'SALES_CUSTOMER_INACTIVE') return 'SALES.INVOICES.ERRORS.CUSTOMER_INACTIVE';
    if (salesInvoiceErrorCode(error) === 'SALES_CUSTOMER_NOT_FOUND') return 'SALES.INVOICES.ERRORS.CUSTOMER_NOT_FOUND';
    return 'SALES.INVOICES.ERRORS.UPDATE_FAILED';
  }
}
