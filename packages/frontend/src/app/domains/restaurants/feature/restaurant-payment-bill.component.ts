import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantCashQueries, CashContext } from '../data-access/restaurant-cash.queries';
import { formatExactMoney } from '../../../shared/utils/exact-money-display';
@Component({
  selector: 'liass-restaurant-payment-bill',
  imports: [
    LiassStatusChipComponent,
    LiassSkeletonComponent,
    MatButtonModule,
    FormsModule,
    LiassSearchableSelectComponent,
    TranslocoModule,
  ],
  template: `@if (query.isPending()) {
      <p role="status">{{ 'RESTAURANTS.CASH.LOADING' | transloco }}</p>
      <liass-skeleton variant="block" />
    }
    @if (query.isError()) {
      <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
      <button mat-button (click)="query.refetch()">
        {{ 'RESTAURANTS.CASH.RETRY' | transloco }}
      </button>
    }
    @if (!query.isError() && query.data()?.pages?.[0]; as bill) {
      <h3 class="break-words font-semibold">{{ bill.session.tableName }}</h3>
      <liass-status-chip
        [label]="'RESTAURANTS.PAYMENT_ACTIONS.' + bill.session.status | transloco"
        [tone]="bill.session.status === 'CLOSED' ? 'neutral' : 'success'"
        size="sm"
      />
      <dl class="my-4 grid grid-cols-2 gap-3 border-y border-app-border py-4 text-sm">
        <dt>{{ 'RESTAURANTS.CHECKOUT.DUE' | transloco }}</dt>
        <dd class="text-right tabular-nums">
          {{ money(bill.session.dueMinor, bill.session.currency) }}
        </dd>
        <dt>{{ 'RESTAURANTS.CHECKOUT.PAID' | transloco }}</dt>
        <dd class="text-right tabular-nums">
          {{ money(bill.session.paidMinor, bill.session.currency) }}
        </dd>
        <dt>{{ 'RESTAURANTS.CHECKOUT.REMAINING' | transloco }}</dt>
        <dd class="text-right tabular-nums">
          {{ money(bill.session.dueMinor - bill.session.paidMinor, bill.session.currency) }}
        </dd>
        @for (method of methods; track method) {
          @if (bill.session.paidByMethodMinor?.[method]; as amount) {
            <dt>{{ 'RESTAURANTS.CASH.' + method | transloco }}</dt>
            <dd class="text-right tabular-nums">{{ money(amount, bill.session.currency) }}</dd>
          }
        }
      </dl>
      @if (bill.orders.length > 1) {
        <liass-searchable-select
          labelKey="RESTAURANTS.CHECKOUT.ORDER"
          controlType="select"
          [options]="orderOptions(bill.orders, bill.session.currency)"
          [ngModel]="order() || bill.orderId"
          (ngModelChange)="order.set($event || '')"
        />
      }
      @for (line of lines(); track line.itemId) {
        <div class="min-w-0 border-b border-app-border py-2 text-sm">
          <p class="break-words" [class.line-through]="!!line.cancelledAt">
            {{ line.snapshot.quantity }} × {{ line.snapshot.name }}
          </p>
          <p class="text-app-muted">
            {{ money(line.snapshot.unitPriceMinor, bill.session.currency) }}
          </p>
          <p class="text-right tabular-nums">
            {{ money(line.netAmountMinor, bill.session.currency) }}
          </p>
          @if (line.cancelledAt) {
            <p>{{ 'RESTAURANTS.CHECKOUT.CANCELLED' | transloco }}</p>
          }
        </div>
      }
      @if (query.hasNextPage()) {
        <button mat-button [disabled]="query.isFetchingNextPage()" (click)="query.fetchNextPage()">
          {{ 'RESTAURANTS.CHECKOUT.MORE_LINES' | transloco }}
        </button>
      }
    }`,
})
export class RestaurantPaymentBillComponent {
  readonly context = input.required<CashContext>();
  readonly row = input.required<c.RestaurantCashPaymentRow>();
  readonly order = signal('');
  readonly methods = ['CASH', 'MOBILE_MONEY', 'CARD'] as const;
  private readonly cash = inject(RestaurantCashQueries);
  private readonly i18n = inject(TranslocoService);
  readonly query = injectInfiniteQuery(() =>
    this.cash.bill(this.context(), this.row(), this.order()),
  );
  readonly lines = computed(() => this.query.data()?.pages.flatMap((p) => p.lines) ?? []);
  orderOptions(orders: { orderId: string; dueMinor: number }[], currency: string) {
    return orders.map((item, index) => ({
      value: item.orderId,
      label:
        this.i18n.translate('RESTAURANTS.CHECKOUT.ORDER') +
        ' ' +
        (index + 1) +
        ' · ' +
        this.money(item.dueMinor, currency),
    }));
  }
  money(amount: number, currency: string) {
    return formatExactMoney(String(amount), currency, this.i18n.getActiveLang());
  }
}
