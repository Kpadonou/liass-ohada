import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { SalesCatalogItem } from '@liass-ohada/shared/sales';
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
import { SalesItemsApi } from '../../data-access/sales-items.api';
import { SalesItemsQueries } from '../../data-access/sales-items.queries';
import { SalesItemDialogComponent } from './sales-item-dialog.component';

const PAGE_SIZE = 50;

@Component({
  selector: 'liass-sales-items-page',
  host: { class: 'block' },
  imports: [LiassButtonComponent, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent, LiassStatusChipComponent, MatDialogModule, MatIconModule, MatMenuModule, TranslocoModule],
  templateUrl: './sales-items.page.html'
})
export class SalesItemsPage {
  private readonly api = inject(SalesItemsApi);
  protected readonly capabilities = inject(SalesCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly productAccess = inject(ProductAccessState);
  private readonly queries = inject(SalesItemsQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<string[]>([]);
  protected readonly mutatingItemId = signal<string | null>(null);
  protected readonly availability = computed(() => this.productAccess.availability('SALES'));
  protected readonly canLoad = computed(() => this.availability() === 'AVAILABLE' && this.capabilities.canRead());
  protected readonly itemsQuery = injectQuery(() => this.queries.list({ limit: PAGE_SIZE, cursor: this.cursor() }, this.canLoad()));
  protected readonly items = computed(() => this.itemsQuery.data()?.items ?? []);
  protected readonly hasPrevious = computed(() => this.cursorHistory().length > 0);
  protected readonly hasNext = computed(() => !!this.itemsQuery.data()?.nextCursor);

  protected typeKey(item: SalesCatalogItem): string { return `SALES.ITEMS.TYPES.${item.itemType}`; }
  protected statusKey(item: SalesCatalogItem): string { return item.isActive ? 'SALES.ITEMS.STATUS.ACTIVE' : 'SALES.ITEMS.STATUS.INACTIVE'; }

  protected nextPage(): void {
    const next = this.itemsQuery.data()?.nextCursor;
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

  protected openCreate(): void { if (this.capabilities.canWrite()) this.openForm({ mode: 'create' }); }

  protected async openEdit(item: SalesCatalogItem): Promise<void> {
    if (!this.capabilities.canWrite()) return;
    try {
      const current = await this.queryClient.fetchQuery(this.queries.detail(item.id));
      this.openForm({ mode: 'edit', item: current });
    } catch (error) {
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('SALES.ITEMS.ERRORS.DETAIL_FAILED'));
    }
  }

  protected confirmStatus(item: SalesCatalogItem): void {
    if (!this.capabilities.canWrite()) return;
    const deactivate = item.isActive;
    this.dialog.open(LiassConfirmationDialogComponent, {
      data: {
        titleKey: deactivate ? 'SALES.ITEMS.LIFECYCLE.DEACTIVATE_TITLE' : 'SALES.ITEMS.LIFECYCLE.ACTIVATE_TITLE',
        descriptionKey: deactivate ? 'SALES.ITEMS.LIFECYCLE.DEACTIVATE_DESCRIPTION' : 'SALES.ITEMS.LIFECYCLE.ACTIVATE_DESCRIPTION',
        descriptionParams: { name: item.name },
        confirmKey: deactivate ? 'SALES.ITEMS.ACTIONS.DEACTIVATE' : 'SALES.ITEMS.ACTIONS.ACTIVATE',
        cancelKey: 'COMMON.ACTIONS.CANCEL',
        tone: deactivate ? 'danger' : 'brand'
      },
      disableClose: true,
      panelClass: 'liass-dialog-panel',
      width: '480px',
      maxWidth: 'calc(100vw - 32px)'
    }).afterClosed().pipe(take(1)).subscribe((confirmed) => { if (confirmed) void this.changeStatus(item); });
  }

  protected retry(): void { void this.itemsQuery.refetch(); }

  private openForm(data: { mode: 'create' | 'edit'; item?: SalesCatalogItem }): void {
    this.dialog.open(SalesItemDialogComponent, {
      data,
      panelClass: 'liass-dialog-panel',
      width: '680px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100dvh - 24px)'
    }).afterClosed().pipe(take(1)).subscribe((item) => {
      if (!item) return;
      this.queryClient.setQueryData(this.queries.detailKey(item.id), item);
      void this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
    });
  }

  private async changeStatus(item: SalesCatalogItem): Promise<void> {
    this.mutatingItemId.set(item.id);
    try {
      const result = item.isActive
        ? await this.api.deactivate(item.id, item.version)
        : await this.api.activate(item.id, item.version);
      this.queryClient.setQueryData(this.queries.detailKey(item.id), result.data);
      await this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
      const fallback = item.isActive ? 'SALES.ITEMS.NOTIFICATIONS.DEACTIVATED' : 'SALES.ITEMS.NOTIFICATIONS.ACTIVATED';
      this.notification.success(result.message ?? this.transloco.translate(fallback));
    } catch (error) {
      const conflict = error instanceof HttpErrorResponse && error.status === 409;
      const key = conflict ? 'SALES.ITEMS.ERRORS.CONFLICT' : 'SALES.ITEMS.ERRORS.STATUS_FAILED';
      this.notification.error(conflict ? this.transloco.translate(key) : safeMessageFromError(error) ?? this.transloco.translate(key));
      await Promise.all([
        this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() }),
        this.queryClient.invalidateQueries({ queryKey: this.queries.detailKey(item.id) })
      ]);
    } finally {
      this.mutatingItemId.set(null);
    }
  }
}
