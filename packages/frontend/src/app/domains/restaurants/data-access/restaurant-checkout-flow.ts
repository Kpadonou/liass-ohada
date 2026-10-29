import { RestaurantCashQueries } from './restaurant-cash.queries';
import { CaptureRestaurantPaymentRequestSchema } from '@liass-ohada/shared/restaurants';
import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  GuestSessionRead,
  RestaurantOrder,
  CaptureRestaurantPaymentRequest,
} from '@liass-ohada/shared/restaurants';
import { RestaurantCheckoutApi } from './restaurant-checkout.api';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { RestaurantsApi } from './restaurants.api';
import { checkoutClosureBlockers } from '../utils/restaurant-checkout';

export type CloseIntent = { clientRequestId: string; expectedVersion: number };
/** Retains ambiguous command identities in memory, never financial or auth authority. */
@Injectable({ providedIn: 'root' })
export class RestaurantCheckoutFlow {
  private readonly api = inject(RestaurantCheckoutApi);
  private readonly cash = inject(RestaurantCashQueries);
  private readonly ordersApi = inject(RestaurantOrdersApi);
  private readonly sessions = inject(RestaurantsApi);
  private readonly intents = new Map<string, CloseIntent>();
  private readonly payments = new Map<string, CaptureRestaurantPaymentRequest>();
  private readonly busy = new Set<string>();
  private key(ctx: ServiceOrderContext) {
    return JSON.stringify(ctx);
  }
  async capture(ctx: ServiceOrderContext, proposal: CaptureRestaurantPaymentRequest) {
    const key = this.key(ctx);
    this.ordersApi.assertContext(ctx);
    if (this.busy.has(key)) throw new Error('Command pending');
    CaptureRestaurantPaymentRequestSchema.parse(proposal);
    const previous = this.payments.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(proposal))
      throw new Error('Unresolved payment');
    this.payments.set(key, structuredClone(proposal));
    this.busy.add(key);
    try {
      const cashContext = this.cash.context();
      if (
        cashContext.org !== ctx.org ||
        cashContext.outlet !== ctx.outlet ||
        cashContext.user !== ctx.user ||
        cashContext.revision !== ctx.revision
      )
        throw new Error('Cash context changed');
      if (!(await this.cash.requirePayment(cashContext))) throw new Error('Cash session required');
      const result = await this.api.capture(ctx, proposal);
      await this.cash.reconcile(cashContext);
      this.payments.delete(key);
      return result;
    } catch (error) {
      // A definite rejection permits a fresh proposal after canonical refresh.
      if (
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
        this.payments.delete(key);
      throw error;
    } finally {
      this.busy.delete(key);
    }
  }
  pendingClosure(ctx: ServiceOrderContext) {
    return this.intents.has(this.key(ctx) + ':session');
  }
  pendingPayment(ctx: ServiceOrderContext) {
    return this.payments.get(this.key(ctx));
  }
  private async command(
    ctx: ServiceOrderContext,
    order: RestaurantOrder | null,
    session?: GuestSessionRead,
  ) {
    const key = this.key(ctx) + ':' + (order?.orderId ?? 'session');
    const intent = this.intents.get(key) ?? {
      clientRequestId: crypto.randomUUID(),
      expectedVersion: order?.version ?? session!.version,
    };
    this.intents.set(key, intent);
    try {
      const result = order
        ? await this.api.closeOrder(ctx, order.orderId, intent)
        : await this.api.closeSession(ctx, intent);
      this.intents.delete(key);
      return result;
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
        this.intents.delete(key);
      throw error;
    }
  }
  async close(
    ctx: ServiceOrderContext,
    rows: readonly RestaurantOrder[],
    progress: (closed: number, total: number) => void,
    reconciled?: (order: RestaurantOrder) => void,
  ) {
    const key = this.key(ctx);
    this.ordersApi.assertContext(ctx);
    if (this.busy.has(key)) throw new Error('Command pending');
    this.busy.add(key);
    try {
      // Retry a lost final response before an OPEN-only keyed read can reject the closed visit.
      const pending = this.intents.get(key + ':session');
      if (pending) {
        const result = await this.api.closeSession(ctx, pending);
        this.intents.delete(key + ':session');
        return result;
      }
      const open = rows.filter(
        (order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED',
      );
      let closed = 0;
      progress(closed, open.length);
      for (const row of open) {
        this.ordersApi.assertContext(ctx);
        const retry = this.intents.has(key + ':' + row.orderId);
        const order = retry ? row : await this.ordersApi.order(ctx, row.orderId);
        let result = order;
        if (order.status !== 'CLOSED' && order.status !== 'CANCELLED')
          result = (await this.command(ctx, order)) as RestaurantOrder;
        this.ordersApi.assertContext(ctx);
        reconciled?.(result);
        progress(++closed, open.length);
      }
      const session = await this.sessions.guestSession(ctx.org, ctx.outlet, ctx.session);
      this.ordersApi.assertContext(ctx);
      if (
        session.openOrderCount ||
        session.status !== 'OPEN' ||
        checkoutClosureBlockers(session, [], false).some((b) => b !== 'INCOMPLETE')
      )
        throw new Error('Closure blocked');
      return (await this.command(ctx, null, session)) as GuestSessionRead;
    } finally {
      this.busy.delete(key);
    }
  }
}
