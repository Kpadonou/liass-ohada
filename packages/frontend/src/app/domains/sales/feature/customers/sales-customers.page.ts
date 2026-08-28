import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { SalesCustomer } from '@liass-ohada/shared/sales';
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
import { LiassTablePreferencesDialogComponent } from '../../../../shared/ui/table-preferences/table-preferences-dialog.component';
import type { LiassTableColumnPreference } from '../../../../shared/ui/table-preferences/table-preferences.model';
import { loadTablePreferences, saveTablePreferences } from '../../../../shared/ui/table-preferences/table-preferences.storage';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesCustomersApi } from '../../data-access/sales-customers.api';
import { SalesCustomersQueries } from '../../data-access/sales-customers.queries';
import { SalesCustomerDialogComponent } from './sales-customer-dialog.component';

type CustomerColumn = 'name' | 'type' | 'phone' | 'email' | 'taxIdentifier' | 'status' | 'actions';
const PAGE_SIZE = 50;
const TABLE_ID = 'sales.customers';
const COLUMNS: LiassTableColumnPreference[] = [
  { id: 'name', labelKey: 'SALES.CUSTOMERS.TABLE.NAME', required: true },
  { id: 'type', labelKey: 'SALES.CUSTOMERS.TABLE.TYPE' },
  { id: 'phone', labelKey: 'SALES.CUSTOMERS.TABLE.PHONE' },
  { id: 'email', labelKey: 'SALES.CUSTOMERS.TABLE.EMAIL' },
  { id: 'taxIdentifier', labelKey: 'SALES.CUSTOMERS.TABLE.TAX_IDENTIFIER' },
  { id: 'status', labelKey: 'SALES.CUSTOMERS.TABLE.STATUS' },
  { id: 'actions', labelKey: 'SALES.CUSTOMERS.TABLE.ACTIONS', required: true }
];

@Component({
  selector: 'liass-sales-customers-page',
  host: { class: 'block' },
  imports: [LiassButtonComponent, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent, LiassStatusChipComponent, MatDialogModule, MatIconModule, MatMenuModule, TranslocoModule],
  templateUrl: './sales-customers.page.html'
})
export class SalesCustomersPage {
  private readonly api = inject(SalesCustomersApi);
  protected readonly capabilities = inject(SalesCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly productAccess = inject(ProductAccessState);
  private readonly queries = inject(SalesCustomersQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<string[]>([]);
  protected readonly mutatingCustomerId = signal<string | null>(null);
  protected readonly visibleColumnIds = signal(loadTablePreferences(TABLE_ID, COLUMNS));
  protected readonly availability = computed(() => this.productAccess.availability('SALES'));
  protected readonly canLoad = computed(() => this.availability() === 'AVAILABLE' && this.capabilities.canRead());
  protected readonly customersQuery = injectQuery(() => this.queries.list({ limit: PAGE_SIZE, cursor: this.cursor() }, this.canLoad()));
  protected readonly customers = computed(() => this.customersQuery.data()?.items ?? []);
  protected readonly hasPrevious = computed(() => this.cursorHistory().length > 0);
  protected readonly hasNext = computed(() => !!this.customersQuery.data()?.nextCursor);

  protected isColumnVisible(column: CustomerColumn): boolean { return this.visibleColumnIds().includes(column); }
  protected typeKey(customer: SalesCustomer): string { return `SALES.CUSTOMERS.TYPES.${customer.customerType}`; }
  protected statusKey(customer: SalesCustomer): string { return customer.isActive ? 'SALES.CUSTOMERS.STATUS.ACTIVE' : 'SALES.CUSTOMERS.STATUS.INACTIVE'; }
  protected address(customer: SalesCustomer): string {
    const value = customer.billingAddress;
    return value ? [value.line1, value.line2, value.city, value.postalCode, value.country].filter(Boolean).join(', ') : '';
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

  protected openPreferences(): void {
    this.dialog.open(LiassTablePreferencesDialogComponent, {
      data: { columns: COLUMNS, tableId: TABLE_ID, visibleColumnIds: this.visibleColumnIds() },
      panelClass: 'liass-dialog-panel', width: '560px', maxWidth: 'calc(100vw - 32px)'
    }).afterClosed().pipe(take(1)).subscribe((value: string[] | undefined) => {
      if (!value) return;
      this.visibleColumnIds.set(saveTablePreferences(TABLE_ID, COLUMNS, value));
    });
  }

  protected openCreate(): void { if (this.capabilities.canWrite()) this.openForm({ mode: 'create' }); }

  protected async openEdit(customer: SalesCustomer): Promise<void> {
    if (!this.capabilities.canWrite()) return;
    try {
      const current = await this.queryClient.fetchQuery(this.queries.detail(customer.id));
      this.openForm({ mode: 'edit', customer: current });
    } catch (error) {
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('SALES.CUSTOMERS.ERRORS.DETAIL_FAILED'));
    }
  }

  protected confirmStatus(customer: SalesCustomer): void {
    if (!this.capabilities.canWrite()) return;
    const deactivate = customer.isActive;
    this.dialog.open(LiassConfirmationDialogComponent, {
      data: {
        titleKey: deactivate ? 'SALES.CUSTOMERS.LIFECYCLE.DEACTIVATE_TITLE' : 'SALES.CUSTOMERS.LIFECYCLE.ACTIVATE_TITLE',
        descriptionKey: deactivate ? 'SALES.CUSTOMERS.LIFECYCLE.DEACTIVATE_DESCRIPTION' : 'SALES.CUSTOMERS.LIFECYCLE.ACTIVATE_DESCRIPTION',
        descriptionParams: { name: customer.name },
        confirmKey: deactivate ? 'SALES.CUSTOMERS.ACTIONS.DEACTIVATE' : 'SALES.CUSTOMERS.ACTIONS.ACTIVATE',
        cancelKey: 'COMMON.ACTIONS.CANCEL',
        tone: deactivate ? 'danger' : 'brand'
      },
      disableClose: true, panelClass: 'liass-dialog-panel', width: '480px', maxWidth: 'calc(100vw - 32px)'
    }).afterClosed().pipe(take(1)).subscribe((confirmed) => { if (confirmed) void this.changeStatus(customer); });
  }

  protected retry(): void { void this.customersQuery.refetch(); }

  private openForm(data: { mode: 'create' | 'edit'; customer?: SalesCustomer }): void {
    this.dialog.open(SalesCustomerDialogComponent, {
      data, panelClass: 'liass-dialog-panel', width: '760px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)'
    }).afterClosed().pipe(take(1)).subscribe((customer) => {
      if (!customer) return;
      this.queryClient.setQueryData(this.queries.detailKey(customer.id), customer);
      void this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
    });
  }

  private async changeStatus(customer: SalesCustomer): Promise<void> {
    this.mutatingCustomerId.set(customer.id);
    try {
      const result = customer.isActive
        ? await this.api.deactivate(customer.id, customer.version)
        : await this.api.activate(customer.id, customer.version);
      this.queryClient.setQueryData(this.queries.detailKey(customer.id), result.data);
      await this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
      const fallback = customer.isActive ? 'SALES.CUSTOMERS.NOTIFICATIONS.DEACTIVATED' : 'SALES.CUSTOMERS.NOTIFICATIONS.ACTIVATED';
      this.notification.success(result.message ?? this.transloco.translate(fallback));
    } catch (error) {
      const conflict = error instanceof HttpErrorResponse && error.status === 409;
      const key = conflict ? 'SALES.CUSTOMERS.ERRORS.CONFLICT' : 'SALES.CUSTOMERS.ERRORS.STATUS_FAILED';
      this.notification.error(conflict ? this.transloco.translate(key) : safeMessageFromError(error) ?? this.transloco.translate(key));
      await Promise.all([
        this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() }),
        this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(customer.id) })
      ]);
    } finally { this.mutatingCustomerId.set(null); }
  }
}
