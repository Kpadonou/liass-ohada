import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import type { SalesInvoiceSummary } from '@liass-ohada/shared/sales';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { ProductAccessState } from '../../../../core/product-access/product-access.state';
import { safeMessageFromError } from '../../../../core/notifications/notification-message';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import { SalesCapabilities } from '../../data-access/sales-capabilities';
import { SalesInvoicesApi } from '../../data-access/sales-invoices.api';
import { SalesInvoicesQueries } from '../../data-access/sales-invoices.queries';
import { formatExactMoney } from '../../utils/exact-money-display';

const PAGE_SIZE = 50;

@Component({
  selector: 'liass-sales-invoices-page',
  host: { class: 'block' },
  imports: [LiassButtonComponent, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent, LiassStatusChipComponent, MatIconModule, TranslocoModule],
  templateUrl: './sales-invoices.page.html'
})
export class SalesInvoicesPage {
  private readonly api = inject(SalesInvoicesApi);
  protected readonly capabilities = inject(SalesCapabilities);
  private readonly notification = inject(NotificationService);
  private readonly productAccess = inject(ProductAccessState);
  private readonly queries = inject(SalesInvoicesQueries);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly cursor = signal<string | undefined>(undefined);
  protected readonly cursorHistory = signal<string[]>([]);
  protected readonly creating = signal(false);
  protected readonly availability = computed(() => this.productAccess.availability('SALES'));
  protected readonly canLoad = computed(() => this.availability() === 'AVAILABLE' && this.capabilities.canRead());
  protected readonly invoicesQuery = injectQuery(() => this.queries.list({ limit: PAGE_SIZE, cursor: this.cursor() }, this.canLoad()));
  protected readonly invoices = computed(() => this.invoicesQuery.data()?.items ?? []);
  protected readonly hasPrevious = computed(() => this.cursorHistory().length > 0);
  protected readonly hasNext = computed(() => !!this.invoicesQuery.data()?.nextCursor);

  protected money(value: string, currency: string): string {
    return formatExactMoney(value, currency, this.transloco.getActiveLang());
  }

  protected reference(invoice: SalesInvoiceSummary): string { return invoice.id.slice(-8).toUpperCase(); }

  protected async createDraft(): Promise<void> {
    if (!this.capabilities.canWrite() || this.creating()) return;
    this.creating.set(true);
    try {
      const result = await this.api.create({});
      this.queryClient.setQueryData(this.queries.detailKey(result.data.id), result.data);
      await this.queryClient.invalidateQueries({ queryKey: this.queries.rootKey() });
      this.notification.success(result.message ?? this.transloco.translate('SALES.INVOICES.NOTIFICATIONS.CREATED'));
      await this.router.navigate(['/sales/invoices', result.data.id]);
    } catch (error) {
      this.notification.error(safeMessageFromError(error) ?? this.transloco.translate('SALES.INVOICES.ERRORS.CREATE_FAILED'));
    } finally { this.creating.set(false); }
  }

  protected open(invoice: SalesInvoiceSummary): void { void this.router.navigate(['/sales/invoices', invoice.id]); }

  protected nextPage(): void {
    const next = this.invoicesQuery.data()?.nextCursor;
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

  protected retry(): void { void this.invoicesQuery.refetch(); }
}
