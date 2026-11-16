import { RouterLink } from '@angular/router';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
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
import { businessOrderVisible } from '../utils/restaurant-order-presentation';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries, restaurantKeys } from '../data-access/restaurants.queries';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { RestaurantCheckoutFlow } from '../data-access/restaurant-checkout-flow';
import { RestaurantCheckoutPaymentDialog } from './restaurant-checkout-payment.dialog';
import { RestaurantCheckoutLinesComponent } from './restaurant-checkout-lines.component';
import { checkoutClosureBlockers } from '../utils/restaurant-checkout';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { checkoutError } from '../utils/restaurant-checkout-error';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { RestaurantInvoiceCustomer } from '@liass-ohada/shared/restaurants';
@Component({
  selector: 'liass-checkout-visit',
  imports: [
    RouterLink,
    MatButtonModule,
    MatDialogModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule,
    RestaurantCheckoutLinesComponent,
  ],
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
        <h3 class="font-semibold">{{ 'RESTAURANTS.CHECKOUT.BILL_PREVIEW' | transloco }}</h3>
        @for (order of businessRows(); track order.orderId; let index = $index) {
          <details
            data-testid="checkout-order"
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
      <details class="mb-4 border-y border-app-border py-3" data-testid="checkout-customer">
        <summary class="cursor-pointer font-medium">
          {{ 'RESTAURANTS.CHECKOUT.CUSTOMER' | transloco }} · {{ customerLabel() }}
        </summary>
        <form [formGroup]="customerForm" class="mt-3 grid gap-2 sm:grid-cols-2">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ 'RESTAURANTS.RECEIPT.CUSTOMER_NAME' | transloco }}</mat-label>
            <input matInput formControlName="name" maxlength="160" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ 'RESTAURANTS.RECEIPT.CUSTOMER_IFU' | transloco }}</mat-label>
            <input matInput formControlName="ifu" maxlength="32" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ 'RESTAURANTS.RECEIPT.CUSTOMER_CONTACT' | transloco }}</mat-label>
            <input matInput formControlName="contact" maxlength="160" />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ 'RESTAURANTS.RECEIPT.CUSTOMER_ADDRESS' | transloco }}</mat-label>
            <input matInput formControlName="address" maxlength="250" />
          </mat-form-field>
          @if (customerError()) {
            <p role="alert" class="text-sm text-app-error sm:col-span-2">
              {{ 'RESTAURANTS.RECEIPT.CUSTOMER_NAME_REQUIRED' | transloco }}
            </p>
          }
          <p class="text-xs text-app-text-secondary sm:col-span-2">
            {{ 'RESTAURANTS.CHECKOUT.CUSTOMER_HINT' | transloco }}
          </p>
        </form>
      </details>
      @if (visit.dueMinor > visit.paidMinor + visit.reservedMinor) {
        <section
          class="mb-4 border-t border-app-border pt-4"
          aria-labelledby="checkout-payment-heading"
        >
          <h3 id="checkout-payment-heading" class="mb-3 font-semibold">
            {{ 'RESTAURANTS.CHECKOUT.PAYMENT' | transloco }}
          </h3>
          @if (cashState() !== 'READY') {
            <p role="status">{{ 'RESTAURANTS.CASH.CONTEXT_' + cashState() | transloco }}</p>
            @if (
              cashState() === 'NO_SESSION' || (cashState() === 'NO_DAY' && caps.canManageSetup())
            ) {
              <a mat-button routerLink="/restaurants/cash">{{
                'RESTAURANTS.CASH.' + (cashState() === 'NO_DAY' ? 'OPEN_DAY' : 'OPEN_CASH')
                  | transloco
              }}</a>
            }
            @if (cashState() === 'NO_DAY' && !caps.canManageSetup()) {
              <p>{{ 'RESTAURANTS.CASH.CONTACT_MANAGER' | transloco }}</p>
            }
            @if (cashState() === 'ERROR') {
              <button mat-button (click)="cashDay.refetch(); cashSession.refetch()">
                {{ 'RESTAURANTS.CASH.RETRY' | transloco }}
              </button>
            }
          }
          <button
            type="button"
            mat-flat-button
            [disabled]="
              cashState() !== 'READY' ||
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
  readonly paymentConfirmed = output<void>();
  readonly invoiceReady = output<RestaurantInvoiceCustomer | null>();
  readonly accessDenied = output<void>();
  readonly caps = inject(RestaurantsCapabilities);
  readonly cash = inject(RestaurantCashQueries);
  readonly cashDay = injectQuery(() => this.cash.day(this.cash.context()));
  readonly cashSession = injectQuery(() => this.cash.current(this.cash.context()));
  readonly cashState = computed(() => {
    const context = this.cash.context(),
      expected = this.ctx();
    if (
      context.org !== expected.org ||
      context.outlet !== expected.outlet ||
      context.user !== expected.user ||
      context.revision !== expected.revision
    )
      return 'CHANGED';
    if (this.cashDay.isPending() || this.cashSession.isPending()) return 'LOADING';
    if (this.cashDay.isError() || this.cashSession.isError()) return 'ERROR';
    const day = this.cashDay.data()?.data,
      session = this.cashSession.data()?.data;
    if (!day || day.status !== 'OPEN') return 'NO_DAY';
    return session?.status === 'OPEN' && session.businessDayId === day.businessDayId
      ? 'READY'
      : 'NO_SESSION';
  });
  private readonly destroy = inject(DestroyRef);
  private readonly queries = inject(RestaurantsQueries);
  private readonly orderQueries = inject(RestaurantOrdersQueries);
  private readonly client = inject(QueryClient);
  private readonly dialog = inject(MatDialog);
  private readonly flow = inject(RestaurantCheckoutFlow);
  private readonly t = inject(TranslocoService);
  readonly customerError = signal(false);
  readonly customerForm = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.maxLength(160)]],
    ifu: ['', [Validators.maxLength(32)]],
    contact: ['', [Validators.maxLength(160)]],
    address: ['', [Validators.maxLength(250)]],
  });
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
  readonly readableSession = computed(() => {
    const error = this.session.error();
    const orderError = this.orders.error();
    const data = this.session.data(),
      ctx = this.ctx();
    return !this.current(ctx) ||
      !data ||
      data.orgId !== ctx.org ||
      data.outletId !== ctx.outlet ||
      data.guestSessionId !== ctx.session ||
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
        return visit;
      },
    };
  });
  readonly orders = injectInfiniteQuery(() => this.orderQueries.orders(this.ctx(), true));
  readonly rows = computed(() => this.orders.data()?.pages.flatMap((page) => page.items) ?? []);
  readonly businessRows = computed(() => this.rows().filter(businessOrderVisible));
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
      this.caps.canCloseCheckout(),
  );
  constructor() {
    effect(() => {
      if (this.accessRejected()) this.accessDenied.emit();
    });
    let initializedSession = '';
    effect(() => {
      const session = this.readableSession();
      if (!session || initializedSession === session.guestSessionId) return;
      initializedSession = session.guestSessionId;
      const customer = session.invoiceCustomer;
      this.customerForm.reset({
        name: customer?.name ?? '',
        ifu: customer?.ifu ?? '',
        contact: customer?.contact ?? '',
        address: customer?.address ?? '',
      });
      this.customerError.set(false);
    });
    effect(() => {
      const session = this.readableSession();
      if (!session) return;
      if (session.status === 'CLOSED') this.customerForm.disable({ emitEvent: false });
      else this.customerForm.enable({ emitEvent: false });
    });
    let announcedVersion = 0;
    effect(() => {
      const session = this.readableSession();
      if (
        !session ||
        session.finalBillId ||
        session.status !== 'OPEN' ||
        session.version === announcedVersion ||
        this.blockers().length
      )
        return;
      const customer = this.invoiceCustomer();
      if (customer === undefined) return;
      announcedVersion = session.version;
      this.invoiceReady.emit(customer);
    });
  }
  customerLabel() {
    return this.customerForm.controls.name.value.trim() ||
      this.t.translate('RESTAURANTS.CHECKOUT.ANONYMOUS_CUSTOMER');
  }
  private invoiceCustomer(): RestaurantInvoiceCustomer | null | undefined {
    const value = this.customerForm.getRawValue();
    const name = value.name.trim();
    const ifu = value.ifu.trim();
    const contact = value.contact.trim();
    const address = value.address.trim();
    if (!name && (ifu || contact || address)) {
      this.customerError.set(true);
      return undefined;
    }
    this.customerError.set(false);
    return name
      ? {
          name,
          ...(ifu ? { ifu } : {}),
          ...(contact ? { contact } : {}),
          ...(address ? { address } : {}),
        }
      : null;
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
        queryKey: restaurantKeys.session(ctx.org, ctx.outlet, ctx.session, ctx.user, ctx.revision),
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
      this.cashState() !== 'READY' ||
      !session ||
      !this.complete() ||
      session.status !== 'OPEN' ||
      this.busy() ||
      !this.caps.canCapturePayment()
    )
      return;
    const invoiceCustomer = this.invoiceCustomer();
    if (invoiceCustomer === undefined) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ref = this.dialog.open(RestaurantCheckoutPaymentDialog, {
        width: '440px',
        maxWidth: '96vw',
        data: { ctx, session, orders: this.rows(), invoiceCustomer },
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
      if (result?.result && this.current(ctx)) this.paymentConfirmed.emit();
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
    const invoiceCustomer = this.invoiceCustomer();
    if (invoiceCustomer === undefined) return;
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
        invoiceCustomer,
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
