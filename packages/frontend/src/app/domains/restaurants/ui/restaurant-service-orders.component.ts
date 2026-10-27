import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import type { RestaurantOrder, RestaurantOrderItem } from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersQueries } from '../data-access/restaurant-orders.queries';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { RestaurantServicePreparationQueries } from '../data-access/restaurant-service-preparation.queries';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';

/** Reads the existing canonical caches, independently of the editable Order selection. */
@Component({
  selector: 'liass-restaurant-service-order',
  host: { class: 'block' },
  imports: [MatIconModule, DatePipe, MatButtonModule, TranslocoModule],
  template: `@if (!accessBlocked()) {
    <article class="space-y-3 border-t border-app-border pt-4" data-testid="service-order">
      <div class="flex flex-wrap justify-between gap-2">
        <div>
          <h3 class="font-semibold">
            {{ 'RESTAURANTS.SERVICE_ORDERS.ORDER' | transloco }}
            <time [attr.datetime]="order().createdAt">{{
              order().createdAt | date: 'dd/MM HH:mm:ss'
            }}</time>
          </h3>
          <p class="text-sm text-app-text-secondary">
            <span
              [class.text-brand-700]="fromQr()"
              [class.dark:text-brand-300]="fromQr()"
              data-testid="order-source"
              >{{
                (fromQr() ? 'RESTAURANTS.SERVICE_ORDERS.QR' : 'RESTAURANTS.SERVICE_ORDERS.STAFF')
                  | transloco
              }}</span
            >
          </p>
          @if (rounds().length) {
            <p class="text-sm">
              {{ 'RESTAURANTS.SERVICE_ORDERS.PROGRESS.' + overall() | transloco }}
            </p>
          }
        </div>
        <p class="font-semibold tabular-nums">{{ price(order().dueMinor) }}</p>
      </div>
      @if (items.isPending()) {
        <p role="status">{{ 'RESTAURANTS.UI.LOADING' | transloco }}</p>
      }
      @for (round of rounds(); track round[0].snapshot!.submissionId) {
        <div class="space-y-2" data-testid="accepted-round">
          <p class="text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.ORDER_TAKING.RECORDED' | transloco }}
            <time [attr.datetime]="round[0].snapshot!.acceptedAt">{{
              round[0].snapshot!.acceptedAt | date: 'dd/MM HH:mm:ss'
            }}</time>
          </p>
          @for (line of round; track line.itemId) {
            <div
              class="flex items-start justify-between gap-3 text-sm"
              data-testid="service-order-line"
            >
              <div class="min-w-0">
                <p class="break-words">{{ line.snapshot!.quantity }} × {{ line.snapshot!.name }}</p>
                <p class="text-app-text-secondary">
                  {{ 'RESTAURANTS.SERVICE_ORDERS.PROGRESS.' + progress(line) | transloco }}
                </p>
                @if (line.notes) {
                  <p class="break-words text-app-text-secondary">{{ line.notes }}</p>
                }
              </div>
              <span class="shrink-0 tabular-nums">{{ price(line.snapshot!.lineTotalMinor) }}</span>
            </div>
          }
        </div>
      }
      @if (items.isError() || preparation.isError()) {
        <p role="alert">{{ 'RESTAURANTS.SERVICE_ORDERS.LOAD_ERROR' | transloco }}</p>
        <button type="button" mat-button (click)="refresh()">
          {{ 'RESTAURANTS.UI.REFRESH' | transloco }}
        </button>
      }
      @if (items.hasNextPage()) {
        <button
          type="button"
          mat-button
          [disabled]="items.isFetching()"
          (click)="items.fetchNextPage()"
        >
          {{ 'RESTAURANTS.SERVICE_ORDERS.MORE_LINES' | transloco }}
        </button>
      }
      @if (preparation.hasNextPage()) {
        <button
          type="button"
          mat-button
          [disabled]="preparation.isFetching()"
          (click)="preparation.fetchNextPage()"
        >
          {{ 'RESTAURANTS.SERVICE_ORDERS.MORE_PROGRESS' | transloco }}
        </button>
      }
      @if (items.isSuccess() && !items.hasNextPage() && !completeLines()) {
        <p role="status" class="text-sm">
          {{ 'RESTAURANTS.SERVICE_ORDERS.INCOMPLETE' | transloco }}
        </p>
      } @else if (items.isSuccess() && !items.hasNextPage() && !rounds().length) {
        <p class="text-sm text-app-text-secondary">
          {{
            (order().acceptedLineCount > 0 || order().dueMinor > 0
              ? 'RESTAURANTS.SERVICE_ORDERS.INCOMPLETE'
              : 'RESTAURANTS.SERVICE_ORDERS.NO_LINES'
            ) | transloco
          }}
        </p>
      }
    </article>
  }`,
})
export class RestaurantServiceOrderComponent {
  readonly context = input.required<ServiceOrderContext>();
  readonly order = input.required<RestaurantOrder>();
  readonly denied = output<void>();
  private readonly queries = inject(RestaurantOrdersQueries);
  private readonly preparationQueries = inject(RestaurantServicePreparationQueries);
  private readonly t = inject(TranslocoService);
  readonly items = injectInfiniteQuery(() =>
    this.queries.items(this.context(), this.order().orderId, true),
  );
  readonly preparation = injectInfiniteQuery(() =>
    this.preparationQueries.pages(
      this.context(),
      this.order().orderId,
      this.order().acceptedLineCount > 0,
    ),
  );
  readonly fromQr = computed(() => /^guest:[A-Za-z0-9_-]{22}$/.test(this.order().createdBy));
  readonly accessBlocked = computed(() =>
    [this.items.error(), this.preparation.error()].some(
      (error) => error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status),
    ),
  );
  readonly rounds = computed(() => {
    const groups = new Map<string, RestaurantOrderItem[]>();
    const lines = new Map(
      (this.items.data()?.pages.flatMap((p) => p.items) ?? []).map((line) => [line.itemId, line]),
    );
    for (const line of lines.values())
      if (line.status === 'ACCEPTED' && line.snapshot)
        groups.set(line.snapshot.submissionId, [
          ...(groups.get(line.snapshot.submissionId) ?? []),
          line,
        ]);
    return [...groups.values()].sort((a, b) =>
      a[0].snapshot!.acceptedAt.localeCompare(b[0].snapshot!.acceptedAt),
    );
  });
  readonly completeLines = computed(
    () =>
      this.items.isSuccess() &&
      !this.items.hasNextPage() &&
      this.rounds().flat().length === this.order().acceptedLineCount,
  );
  readonly overall = computed(() => {
    if (this.order().status === 'CANCELLED') return 'CANCELLED';
    if (
      !this.completeLines() ||
      this.preparation.hasNextPage() ||
      this.items.isError() ||
      this.preparation.isError()
    )
      return 'UNKNOWN';
    const states = this.rounds()
      .flat()
      .map((line) => this.progress(line));
    return states.includes('UNKNOWN')
      ? 'UNKNOWN'
      : states.every((s) => s === 'CANCELLED')
        ? 'CANCELLED'
        : states.every((s) => s === 'SERVED')
          ? 'SERVED'
          : states.some((s) => s === 'PREPARING' || s === 'QUEUED')
            ? 'PREPARING'
            : states.includes('READY')
              ? 'READY'
              : 'CONFIRMED';
  });
  constructor() {
    effect(() => {
      if (this.accessBlocked()) this.denied.emit();
    });
  }
  progress(line: RestaurantOrderItem) {
    if (!line.snapshot?.stationId) return 'CONFIRMED';
    const task = this.preparation
      .data()
      ?.pages.flatMap((p) => p.items)
      .find((t) => t.itemId === line.itemId && t.fireId === line.latestFireId);
    return task
      ? (
          {
            QUEUED: 'QUEUED',
            IN_PROGRESS: 'PREPARING',
            READY: 'READY',
            SERVED: 'SERVED',
            CANCELLED: 'CANCELLED',
          } as const
        )[task.state]
      : 'UNKNOWN';
  }
  price(amount: number) {
    return restaurantOperationalPrice(amount, this.order().currency, this.t.getActiveLang());
  }
  async refresh() {
    await Promise.all([this.items.refetch(), this.preparation.refetch()]);
  }
}

@Component({
  selector: 'liass-restaurant-service-orders',
  host: { class: 'block min-w-0' },
  imports: [
    MatIconModule,
    RestaurantServiceOrderComponent,
    LiassCardComponent,
    TranslocoModule,
    MatButtonModule,
  ],
  template: `@if (validatedOrders().length) {
      <liass-card padding="sm">
        <h2 class="flex items-center gap-2 text-base font-semibold">
          <mat-icon class="text-success-600" aria-hidden="true">check_circle_outline</mat-icon
          >{{ 'RESTAURANTS.SERVICE_ORDERS.TITLE' | transloco }}
        </h2>
        <div class="mt-3 space-y-4">
          @for (order of visibleOrders(); track order.orderId) {
            <liass-restaurant-service-order
              [context]="context()"
              [order]="order"
              (denied)="denied.emit()"
            />
          } @empty {
            <p role="status">
              {{
                (expectedCount() > 0 || expectedAmount() > 0
                  ? 'RESTAURANTS.SERVICE_ORDERS.INCOMPLETE'
                  : 'RESTAURANTS.SERVICE_ORDERS.EMPTY'
                ) | transloco
              }}
            </p>
          }
          @if (validatedOrders().length > limit()) {
            <button type="button" mat-button (click)="limit.set(limit() + 20)">
              {{ 'RESTAURANTS.ORDER_TAKING.MORE_ORDERS' | transloco }}
            </button>
          }
          @if (orders().length > 0 && orders().length < expectedCount()) {
            <p role="status" class="text-sm">
              {{ 'RESTAURANTS.SERVICE_ORDERS.INCOMPLETE' | transloco }}
            </p>
          }
        </div>
      </liass-card>
    } @else if (expectedCount() > orders().length || expectedAmount() > 0) {
      <p role="status" class="text-sm text-app-text-secondary">
        {{ 'RESTAURANTS.SERVICE_ORDERS.INCOMPLETE' | transloco }}
      </p>
    }`,
})
export class RestaurantServiceOrdersComponent {
  readonly context = input.required<ServiceOrderContext>();
  readonly orders = input.required<RestaurantOrder[]>();
  readonly expectedCount = input.required<number>();
  readonly expectedAmount = input(0);
  readonly denied = output<void>();
  readonly limit = signal(20);
  readonly validatedOrders = computed(() =>
    this.orders().filter((order) => order.acceptedLineCount > 0),
  );
  readonly visibleOrders = computed(() => this.validatedOrders().slice(0, this.limit()));
}
