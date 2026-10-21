import {
  Component,
  computed,
  effect,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import {
  injectInfiniteQuery,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import type { InfiniteData } from '@tanstack/angular-query-experimental';
import type { RestaurantOrder } from '@liass-ohada/shared/restaurants';
import { firstValueFrom } from 'rxjs';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantOrdersQueries } from '../data-access/restaurant-orders.queries';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries, restaurantKeys } from '../data-access/restaurants.queries';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { RestaurantCheckoutFlow } from '../data-access/restaurant-checkout-flow';
import { RestaurantCheckoutPaymentDialog } from './restaurant-checkout-payment.dialog';
import { RestaurantCheckoutLinesComponent } from './restaurant-checkout-lines.component';
import { checkoutClosureBlockers } from '../utils/restaurant-checkout';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { checkoutError } from '../utils/restaurant-checkout-error';
@Component({
  selector: 'liass-checkout-visit',
  imports: [MatButtonModule, MatDialogModule, TranslocoModule, RestaurantCheckoutLinesComponent],
  template: `
    @if (readableSession(); as visit) {
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold break-words">{{ visit.tableName }}</h2>
          <p class="mt-1 text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.CHECKOUT.CURRENCY' | transloco: { currency: visit.currency } }}
          </p>
        </div>
        <button type="button" mat-button [disabled]="busy()" (click)="refresh()">
          {{ 'RESTAURANTS.CHECKOUT.REFRESH' | transloco }}
        </button>
      </header>
      <dl
        class="my-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-app-border py-4 text-sm sm:grid-cols-4"
      >
        <div>
          <dt class="text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.CHECKOUT.DUE' | transloco }}
          </dt>
          <dd class="mt-1 font-semibold tabular-nums">{{ money(visit.dueMinor) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.CHECKOUT.PAID' | transloco }}
          </dt>
          <dd class="mt-1 tabular-nums">{{ money(visit.paidMinor) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.CHECKOUT.REMAINING' | transloco }}
          </dt>
          <dd class="mt-1 font-semibold tabular-nums">
            {{ money(visit.dueMinor - visit.paidMinor) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.CHECKOUT.AVAILABLE' | transloco }}
          </dt>
          <dd class="mt-1 tabular-nums">
            {{ money(visit.dueMinor - visit.paidMinor - visit.reservedMinor) }}
          </dd>
        </div>
      </dl>
      @if (visit.reservedMinor || visit.pendingPaymentCount) {
        <p>{{ 'RESTAURANTS.CHECKOUT.BLOCK_PENDING' | transloco }}</p>
      }
      @if (message()) {
        <p role="status" class="my-3">{{ message() }}</p>
      }
      @if (error()) {
        <p role="alert" class="my-3 text-app-error">{{ error() }}</p>
      }
      <section class="my-4">
        <h3 class="font-semibold">{{ 'RESTAURANTS.CHECKOUT.ADDITION' | transloco }}</h3>
        @for (order of rows(); track order.orderId; let index = $index) {
          <details
            class="border-b border-app-border py-2 last:border-b-0"
            (toggle)="expand(order.orderId, $event)"
            [open]="rows().length === 1"
          >
            <summary class="cursor-pointer text-sm">
              {{ 'RESTAURANTS.CHECKOUT.ORDER' | transloco }} {{ index + 1 }} ·
              {{ money(order.dueMinor) }}
              @if (order.status === 'CLOSED') {
                · {{ 'RESTAURANTS.CHECKOUT.ORDER_CLOSED' | transloco }}
              }
            </summary>
            @if (expanded().has(order.orderId) || rows().length === 1) {
              <liass-checkout-lines
                [ctx]="ctx()"
                [orderId]="order.orderId"
                [currency]="visit.currency"
              />
            }
          </details>
        }
        @if (orders.hasNextPage()) {
          <button
            mat-button
            type="button"
            (click)="orders.fetchNextPage()"
            [disabled]="orders.isFetchingNextPage()"
          >
            {{ 'RESTAURANTS.CHECKOUT.MORE_ORDERS' | transloco }}
          </button>
        }
      </section>
      @if (visit.dueMinor > visit.paidMinor + visit.reservedMinor) {
        <section
          class="mb-4 border-t border-app-border pt-4"
          aria-labelledby="checkout-payment-heading"
        >
          <h3 id="checkout-payment-heading" class="mb-3 font-semibold">
            {{ 'RESTAURANTS.CHECKOUT.PAYMENT' | transloco }}
          </h3>
          <button
            type="button"
            mat-flat-button
            [disabled]="
              !caps.canCapturePayment() ||
              busy() ||
              !complete() ||
              visit.dueMinor <= visit.paidMinor + visit.reservedMinor
            "
            (click)="pay()"
          >
            {{ 'RESTAURANTS.CHECKOUT.PAY' | transloco }}
          </button>
        </section>
      }
      <section class="border-t border-app-border pt-4" data-testid="checkout-close-section">
        @if (readyToClose()) {
          <p class="mb-2 font-semibold" role="status" data-testid="ready-to-close">
            {{ 'RESTAURANTS.CHECKOUT.READY_TO_CLOSE' | transloco }}
          </p>
        }
        <h3 class="font-semibold">{{ 'RESTAURANTS.CHECKOUT.CLOSE' | transloco }}</h3>
        @for (blocker of blockers(); track blocker) {
          <p class="my-1 text-sm">{{ 'RESTAURANTS.CHECKOUT.BLOCK_' + blocker | transloco }}</p>
        }
        @if (progress()) {
          <p role="status">{{ progress() }}</p>
        }
        @if (confirming()) {
          <p class="my-2 text-sm">{{ 'RESTAURANTS.CHECKOUT.CONFIRM_CLOSE' | transloco }}</p>
          <button type="button" mat-button (click)="confirming.set(false)">
            {{ 'COMMON.ACTIONS.CANCEL' | transloco }}</button
          ><button type="button" mat-flat-button (click)="close()">
            {{ 'RESTAURANTS.CHECKOUT.CONFIRM' | transloco }}
          </button>
        } @else {
          <button
            type="button"
            mat-flat-button
            [class.liass-action-neutral]="!readyToClose()"
            class="mt-3"
            [disabled]="!caps.canCloseCheckout() || busy() || blockers().length > 0"
            (click)="confirming.set(true)"
          >
            {{ 'RESTAURANTS.CHECKOUT.CLOSE' | transloco }}
          </button>
        }
      </section>
    } @else if (!session.isError()) {
      <p role="status">{{ 'RESTAURANTS.CHECKOUT.LOADING' | transloco }}</p>
    }
    @if (pendingClosure()) {
      <button
        type="button"
        mat-flat-button
        [disabled]="busy() || accessRejected()"
        (click)="close()"
      >
        {{ 'RESTAURANTS.CHECKOUT.RESUME_CLOSE' | transloco }}
      </button>
    }
    @if (session.isError() || orders.isError()) {
      <p role="alert">{{ 'RESTAURANTS.CHECKOUT.READ_ERROR' | transloco }}</p>
    }
  `,
})
export class RestaurantCheckoutVisitComponent {
  readonly ctx = input.required<ServiceOrderContext>();
  readonly closed = output<void>();
  readonly accessDenied = output<void>();
  readonly caps = inject(RestaurantsCapabilities);
  private readonly destroy = inject(DestroyRef);
  private readonly queries = inject(RestaurantsQueries);
  private readonly orderQueries = inject(RestaurantOrdersQueries);
  private readonly client = inject(QueryClient);
  private readonly dialog = inject(MatDialog);
  private readonly flow = inject(RestaurantCheckoutFlow);
  private readonly t = inject(TranslocoService);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  expand(id: string, event: Event) {
    if ((event.target as HTMLDetailsElement).open)
      this.expanded.update((rows) => new Set([...rows, id]));
  }
  readonly busy = signal(false);
  readonly confirming = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly progress = signal('');
  private readonly sessionsApi = inject(RestaurantsApi);
  private readonly verifiedSession = signal(false);
  readonly readableSession = computed(() => {
    const error = this.session.error();
    const orderError = this.orders.error();
    return !this.verifiedSession() ||
      (orderError instanceof HttpErrorResponse && [401, 403, 404].includes(orderError.status)) ||
      (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status))
      ? undefined
      : this.session.data();
  });
  readonly session = injectQuery(() => {
    const ctx = this.ctx();
    return {
      ...this.queries.guestSession(ctx.outlet, ctx.session),
      queryFn: async () => {
        const visit = await this.sessionsApi.guestSession(ctx.org, ctx.outlet, ctx.session);
        this.orderQueries.api.assertContext(ctx);
        if (this.current(ctx)) this.verifiedSession.set(true);
        return visit;
      },
    };
  });
  readonly orders = injectInfiniteQuery(() => this.orderQueries.orders(this.ctx(), true));
  readonly rows = computed(() => this.orders.data()?.pages.flatMap((page) => page.items) ?? []);
  readonly complete = computed(
    () =>
      this.orders.isSuccess() &&
      !this.orders.hasNextPage() &&
      this.rows().length === this.session.data()?.orderCount,
  );
  readonly blockers = computed(() =>
    this.session.data()
      ? checkoutClosureBlockers(this.session.data()!, this.rows(), this.complete())
      : ['INCOMPLETE'],
  );
  readonly readyToClose = computed(
    () =>
      !!this.readableSession() &&
      this.complete() &&
      !this.session.isFetching() &&
      !this.orders.isFetching() &&
      !this.session.isError() &&
      !this.orders.isError() &&
      this.blockers().length === 0 &&
      this.rows().every(
        (o) => ['CLOSED', 'CANCELLED'].includes(o.status) || o.outstandingWorkCount !== undefined,
      ) &&
      this.caps.canCloseCheckout(),
  );
  constructor() {
    effect(() => {
      if (this.accessRejected()) this.accessDenied.emit();
    });
  }
  money(amount: number) {
    const currency = this.session.data()!.currency;
    return restaurantOperationalPrice(amount, currency, this.t.getActiveLang(), currency);
  }
  private current(ctx: ServiceOrderContext) {
    try {
      this.orderQueries.api.assertContext(ctx);
      return JSON.stringify(ctx) === JSON.stringify(this.ctx());
    } catch {
      return false;
    }
  }
  async refresh() {
    const ctx = this.ctx();
    await Promise.all([
      this.client.invalidateQueries({
        queryKey: restaurantKeys.session(ctx.org, ctx.outlet, ctx.session, ctx.user),
        exact: true,
      }),
      this.client.invalidateQueries({
        queryKey: this.orderQueries.key(ctx, 'orders'),
        exact: true,
      }),
    ]);
  }
  async pay() {
    const ctx = this.ctx(),
      session = this.readableSession();
    if (
      !session ||
      !this.complete() ||
      session.status !== 'OPEN' ||
      this.busy() ||
      !this.caps.canCapturePayment()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ref = this.dialog.open(RestaurantCheckoutPaymentDialog, {
        width: '440px',
        maxWidth: '96vw',
        data: { ctx, session, orders: this.rows() },
      });
      const unregister = this.destroy.onDestroy(() => ref.close());
      const result = await firstValueFrom(ref.afterClosed());
      unregister();
      if (!this.current(ctx)) return;
      if (result?.result) {
        await Promise.all(
          result.result.allocations.map((allocation: { orderId: string }) =>
            this.client.invalidateQueries({
              queryKey: this.orderQueries.key(ctx, 'order', allocation.orderId),
              exact: true,
            }),
          ),
        );
      }
      if (result?.result)
        this.message.set(this.t.translate('RESTAURANTS.CHECKOUT.PAYMENT_RECORDED'));
      if (result?.error) this.error.set(this.failure(result.error));
      if (result) await this.refresh();
    } finally {
      if (this.current(ctx)) this.busy.set(false);
    }
  }
  failure(error: unknown) {
    return checkoutError(error, (key) => this.t.translate(key));
  }
  accessRejected() {
    return [this.session.error(), this.orders.error()].some(
      (error) => error instanceof HttpErrorResponse && [401, 403].includes(error.status),
    );
  }
  pendingClosure() {
    return this.flow.pendingClosure(this.ctx());
  }
  async close() {
    const ctx = this.ctx();
    if (
      this.accessRejected() ||
      !this.caps.canCloseCheckout() ||
      this.busy() ||
      (!this.pendingClosure() && this.blockers().length)
    )
      return;
    this.confirming.set(false);
    this.busy.set(true);
    this.error.set('');
    try {
      await this.flow.close(
        ctx,
        this.rows(),
        (closed, total) => {
          if (this.current(ctx))
            this.progress.set(this.t.translate('RESTAURANTS.CHECKOUT.PROGRESS', { closed, total }));
        },
        (order) => {
          if (this.current(ctx))
            this.client.setQueryData<
              InfiniteData<{ items: RestaurantOrder[]; nextCursor?: string }>
            >(this.orderQueries.key(ctx, 'orders'), (data) =>
              data
                ? {
                    ...data,
                    pages: data.pages.map((page) => ({
                      ...page,
                      items: page.items.map((row) => (row.orderId === order.orderId ? order : row)),
                    })),
                  }
                : data,
            );
        },
      );
      if (!this.current(ctx)) return;
      // Canonical closure succeeded. Receipt access must survive an unrelated floor read failure.
      this.closed.emit();
      void this.queries.floorChanged(ctx.org, ctx.outlet).catch(() => undefined);
    } catch (error) {
      if (this.current(ctx)) {
        this.error.set(this.failure(error));
        // A committed final close makes the CASHIER OPEN-only read invalid.
        // Preserve the command and replay it before any such reconciliation.
        if (!this.flow.pendingClosure(ctx)) await this.refresh();
      }
    } finally {
      if (this.current(ctx)) this.busy.set(false);
    }
  }
}
