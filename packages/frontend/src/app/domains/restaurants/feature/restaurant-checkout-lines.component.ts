import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { RestaurantOrdersQueries } from '../data-access/restaurant-orders.queries';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { restaurantPrice } from '../utils/restaurant-money';
@Component({
  selector: 'liass-checkout-lines',
  imports: [MatButtonModule, TranslocoModule],
  template: `@if (query.isPending()) {
      <p role="status">{{ 'RESTAURANTS.CHECKOUT.LOADING' | transloco }}</p>
    }
    @if (query.isError()) {
      <p role="alert">{{ 'RESTAURANTS.CHECKOUT.READ_ERROR' | transloco }}</p>
    }
    @for (line of lines(); track line.itemId) {
      @if (line.snapshot; as sale) {
        <div
          class="flex justify-between gap-3 border-b border-app-border py-2 text-sm"
          [class.opacity-60]="line.status === 'CANCELLED'"
        >
          <div class="min-w-0 break-words">
            <span [class.line-through]="line.status === 'CANCELLED'"
              >{{ sale.quantity }} × {{ sale.name }}</span
            >
            @if (line.status === 'CANCELLED') {
              <span> · {{ 'RESTAURANTS.CHECKOUT.CANCELLED' | transloco }}</span>
            }
            @if (line.notes) {
              <p class="text-app-text-secondary">{{ line.notes }}</p>
            }
          </div>
          <span class="whitespace-nowrap">{{ price(sale.lineTotalMinor, sale.currency) }}</span>
        </div>
      }
    }
    @if (query.hasNextPage()) {
      <button
        type="button"
        mat-button
        [disabled]="query.isFetchingNextPage()"
        (click)="query.fetchNextPage()"
      >
        {{ 'RESTAURANTS.CHECKOUT.MORE_LINES' | transloco }}
      </button>
    }`,
})
export class RestaurantCheckoutLinesComponent {
  readonly ctx = input.required<ServiceOrderContext>();
  readonly orderId = input.required<string>();
  private readonly queries = inject(RestaurantOrdersQueries);
  private readonly t = inject(TranslocoService);
  readonly query = injectInfiniteQuery(() => this.queries.items(this.ctx(), this.orderId(), true));
  readonly lines = computed(
    () =>
      this.query
        .data()
        ?.pages.flatMap((page) => page.items)
        .filter((line) => !!line.snapshot) ?? [],
  );
  price(amount: number, currency: string) {
    return restaurantPrice(amount, currency, this.t.getActiveLang());
  }
}
