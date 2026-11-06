import { MatDialog } from '@angular/material/dialog';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { acceptedItemCancellable } from '../data-access/restaurant-item-cancellation';
import { RestaurantItemCancellationDialog } from '../feature/restaurant-item-cancellation.dialog';
import {
  RestaurantOrderAbandonment,
  orderAbandonable,
} from '../data-access/restaurant-order-abandonment';
import { RestaurantOrderAbandonmentDialog } from '../feature/restaurant-order-abandonment.dialog';
import { businessOrderVisible } from '../utils/restaurant-order-presentation';
import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  DestroyRef,
} from '@angular/core';
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
  imports: [
    MatIconModule,
    DatePipe,
    MatButtonModule,
    TranslocoModule,
    LiassButtonComponent,
    LiassStatusChipComponent,
  ],
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
            <liass-status-chip size="sm" tone="info"
              [label]="'RESTAURANTS.SERVICE_ORDERS.PROGRESS.' + overall() | transloco" />
          }
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <p class="font-semibold tabular-nums">{{ price(order().dueMinor) }}</p>
          @if (order().status === 'CANCELLED') {
            <liass-status-chip
              tone="neutral"
              size="sm"
              [label]="'RESTAURANTS.ORDER_ABANDONMENT.CANCELLED' | transloco"
            />
          }
          @if (canAbandon()) {
            <liass-button
              tone="danger"
              variant="ghost"
              icon="cancel"
              [ariaLabel]="'RESTAURANTS.ORDER_ABANDONMENT.TITLE' | transloco"
              (pressed)="abandon()"
              data-testid="abandon-order"
            >
              {{ 'RESTAURANTS.ORDER_ABANDONMENT.TITLE' | transloco }}
            </liass-button>
          } @else if (canRetryAbandonment()) {
            <liass-button
              tone="danger"
              variant="ghost"
              icon="refresh"
              (pressed)="abandon()"
              data-testid="retry-abandon-order"
            >
              {{ 'RESTAURANTS.ORDER_ABANDONMENT.RETRY' | transloco }}
            </liass-button>
          }
        </div>
      </div>
      @if (order().acceptedLineCount > 0 && items.isPending()) {
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
              class="flex flex-wrap items-start justify-between gap-3 text-sm"
              data-testid="service-order-line"
            >
              <div class="min-w-0">
                <p class="break-words">{{ line.snapshot!.quantity }} × {{ line.snapshot!.name }}</p>
                @if (line.status === 'CANCELLED') {
                  <liass-status-chip
                    tone="neutral"
                    size="sm"
                    [label]="'RESTAURANTS.SERVICE_ORDERS.PROGRESS.CANCELLED' | transloco"
                  />
                  <p class="break-words text-app-text-secondary">{{ line.cancellationReason }}</p>
                } @else {
                  <p class="text-app-text-secondary">
                    {{ 'RESTAURANTS.SERVICE_ORDERS.PROGRESS.' + progress(line) | transloco }}
                  </p>
                }
                @if (line.notes) {
                  <p class="break-words text-app-text-secondary">{{ line.notes }}</p>
                }
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                @if (line.status !== 'CANCELLED') {
                  <span class="shrink-0 tabular-nums">{{
                    price(line.snapshot!.lineTotalMinor)
                  }}</span>
                }
                @if (canCancel(line)) {
                  <liass-button
                    tone="danger"
                    variant="ghost"
                    icon="cancel"
                    [ariaLabel]="'RESTAURANTS.ITEM_CANCELLATION.TITLE' | transloco"
                    (pressed)="cancel(line)"
                    data-testid="cancel-accepted-item"
                  >
                    {{ 'RESTAURANTS.ITEM_CANCELLATION.TITLE' | transloco }}
                  </liass-button>
                }
              </div>
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
      @if (!order().acceptedLineCount) {
        <p class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.SERVICE_ORDERS.NO_LINES' | transloco }}
        </p>
      } @else if (items.isSuccess() && !items.hasNextPage() && !completeLines()) {
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
  readonly tableLabel = input<string>();
  readonly composing = input(false);
  readonly order = input.required<RestaurantOrder>();
  readonly denied = output<void>();
  private readonly dialogs = inject(MatDialog);
  private readonly destroy = inject(DestroyRef);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly abandonment = inject(RestaurantOrderAbandonment);
  private readonly queries = inject(RestaurantOrdersQueries);
  private readonly preparationQueries = inject(RestaurantServicePreparationQueries);
  private readonly t = inject(TranslocoService);
  readonly items = injectInfiniteQuery(() =>
    this.queries.items(this.context(), this.order().orderId, this.order().acceptedLineCount > 0),
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
      if ((line.status === 'ACCEPTED' || line.status === 'CANCELLED') && line.snapshot)
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
  canCancel(line: RestaurantOrderItem) {
    return (
      !this.accessBlocked() &&
      this.caps.canManageSetup() &&
      acceptedItemCancellable(this.order(), line)
    );
  }
  canAbandon() {
    return (
      !this.composing() &&
      !this.accessBlocked() &&
      this.caps.canManageSetup() &&
      orderAbandonable(this.order())
    );
  }
  canRetryAbandonment() {
    return (
      this.order().status !== 'DRAFT' &&
      businessOrderVisible(this.order()) &&
      !this.composing() &&
      !this.accessBlocked() &&
      this.caps.canManageSetup() &&
      !!this.abandonment.pending(this.context(), this.order().orderId)
    );
  }
  abandon() {
    if (!this.canAbandon() && !this.canRetryAbandonment()) return;
    const ref = this.dialogs.open(RestaurantOrderAbandonmentDialog, {
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
      disableClose: true,
      data: {
        context: this.context(),
        order: this.order(),
        tableName: this.tableLabel() ?? this.tableName(),
      },
    });
    const unregister = this.destroy.onDestroy(() => ref.close());
    ref.afterClosed().subscribe(() => unregister());
  }
  private tableName() {
    const context = this.preparation.data()?.pages.flatMap((page) => page.items)[0]?.serviceContext;
    return context?.mode === 'DINE_IN' ? context.tableName : undefined;
  }
  cancel(line: RestaurantOrderItem) {
    if (!this.canCancel(line)) return;
    const ref = this.dialogs.open(RestaurantItemCancellationDialog, {
      width: '480px',
      maxWidth: 'calc(100vw - 32px)',
      data: { context: this.context(), order: this.order(), line, tableName: this.tableName() },
    });
    const unregister = this.destroy.onDestroy(() => ref.close());
    ref.afterClosed().subscribe(() => unregister());
  }
  progress(line: RestaurantOrderItem) {
    if (line.status === 'CANCELLED') return 'CANCELLED';
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
          <mat-icon class="text-app-text-secondary" aria-hidden="true">receipt_long</mat-icon
          >{{ 'RESTAURANTS.ORDER_ABANDONMENT.ORDERS' | transloco }}
        </h2>
        <div class="mt-3 space-y-4">
          @for (order of visibleOrders(); track order.orderId) {
            <liass-restaurant-service-order
              [context]="context()"
              [tableLabel]="tableName()"
              [composing]="activeDraftOrderId() === order.orderId"
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
  readonly tableName = input<string>();
  readonly activeDraftOrderId = input('');
  readonly orders = input.required<RestaurantOrder[]>();
  readonly expectedCount = input.required<number>();
  readonly expectedAmount = input(0);
  readonly denied = output<void>();
  readonly limit = signal(20);
  readonly validatedOrders = computed(() =>
    this.orders().filter(
      (order) =>
        businessOrderVisible(order) &&
        !(order.status === 'DRAFT' && order.orderId === this.activeDraftOrderId()),
    ),
  );
  readonly visibleOrders = computed(() => this.validatedOrders().slice(0, this.limit()));
}
