import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient, type InfiniteData } from '@tanstack/angular-query-experimental';
import type { z } from 'zod';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersQueries } from './restaurant-orders.queries';
import { ServiceOrderContext } from './restaurant-orders.api';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { kitchenKeys } from './restaurant-preparation.queries';
import { restaurantKeys } from './restaurants.queries';
import { servicePreparationKey } from './restaurant-service-preparation.queries';
import { RestaurantSessionReconciliation } from './restaurant-session-reconciliation';
import { inventoryKeys } from './restaurant-inventory.keys';

type CancelIntent = z.infer<typeof c.CancelRestaurantItemRequestSchema>;
export function acceptedItemCancellable(order: c.RestaurantOrder, line: c.RestaurantOrderItem) {
  return (
    order.status === 'SUBMITTED' &&
    line.orderId === order.orderId &&
    line.status === 'ACCEPTED' &&
    !!line.snapshot &&
    BigInt(order.dueMinor) - BigInt(line.snapshot.lineTotalMinor) >=
      BigInt(order.paidMinor) + BigInt(order.reservedMinor)
  );
}

/** Pending command intent only; canonical collections remain in TanStack Query. */
@Injectable({ providedIn: 'root' })
export class RestaurantItemCancellation {
  private readonly queries = inject(RestaurantOrdersQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly client = inject(QueryClient);
  private readonly sessionReconciliation = inject(RestaurantSessionReconciliation);
  private readonly intents = new Map<string, CancelIntent>();
  private readonly busy = new Set<string>();
  private key(ctx: ServiceOrderContext, order: string, item: string) {
    return JSON.stringify([ctx.org, ctx.user, ctx.revision, ctx.outlet, ctx.session, order, item]);
  }
  pending(ctx: ServiceOrderContext, order: string, item: string) {
    return this.intents.get(this.key(ctx, order, item));
  }
  async cancel(
    ctx: ServiceOrderContext,
    order: c.RestaurantOrder,
    line: c.RestaurantOrderItem,
    reason: string,
  ) {
    this.queries.api.assertContext(ctx);
    if (!this.caps.canManageSetup()) throw new HttpErrorResponse({ status: 403 });
    if (
      order.orgId !== ctx.org ||
      order.outletId !== ctx.outlet ||
      order.guestSessionId !== ctx.session ||
      line.orgId !== ctx.org ||
      line.outletId !== ctx.outlet ||
      line.orderId !== order.orderId
    )
      throw new Error('Mismatched cancellation context');
    const key = this.key(ctx, order.orderId, line.itemId);
    if (this.busy.has(key)) throw new Error('Cancellation pending');
    let intent = this.intents.get(key);
    if (!intent) {
      if (!acceptedItemCancellable(order, line)) throw new HttpErrorResponse({ status: 409 });
      intent = c.CancelRestaurantItemRequestSchema.parse({
        clientRequestId: crypto.randomUUID(),
        expectedVersion: order.version,
        expectedItemVersion: line.version,
        reason,
      });
      this.intents.set(key, intent);
    }
    this.busy.add(key);
    let result: c.RestaurantOrderItem;
    try {
      result = c.RestaurantOrderItemSchema.parse(
        await this.queries.api.command(ctx, 'remove', intent, order.orderId, line.itemId),
      );
      this.queries.api.assertContext(ctx);
      if (
        result.itemId !== line.itemId ||
        result.orderId !== order.orderId ||
        result.orgId !== ctx.org ||
        result.outletId !== ctx.outlet ||
        result.status !== 'CANCELLED' ||
        !result.snapshot
      )
        throw new Error('Invalid cancellation result');
      this.intents.delete(key);
    } catch (error) {
      // Unknown outcome retains the exact request, versions and reason across dialog reopen.
      if (
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
        this.intents.delete(key);
      throw error;
    } finally {
      this.busy.delete(key);
    }
    // The response owns only this line, never locally derived financial totals.
    this.client.setQueryData<InfiniteData<{ items: c.RestaurantOrderItem[]; nextCursor?: string }>>(
      this.queries.key(ctx, 'items', order.orderId),
      (old) =>
        old && {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.itemId === result.itemId ? result : item)),
          })),
        },
    );
    await this.reconcile(ctx, order.orderId, line, true);
    return result;
  }
  async reconcile(
    ctx: ServiceOrderContext,
    order: string,
    line: c.RestaurantOrderItem,
    confirmed = false,
  ) {
    this.queries.api.assertContext(ctx);
    const kitchen = { ...ctx };
    const stock = { ...ctx, identity: '' };
    await this.sessionReconciliation.run(ctx, () =>
      Promise.all([
        ...[
          this.queries.key(ctx, 'orders'),
          this.queries.key(ctx, 'order', order),
          servicePreparationKey(ctx, order),
          restaurantKeys.session(ctx.org, ctx.outlet, ctx.session, ctx.user, ctx.revision),
          restaurantKeys.floor(ctx.org, ctx.outlet),
          // A confirmed full line replaces its cached row. Only uncertainty/rejection
          // needs a separate items read; no automatic per-line reread after success.
          ...(!confirmed ? [this.queries.key(ctx, 'items', order)] : []),
        ].map((queryKey) => this.client.invalidateQueries({ queryKey, exact: true })),
        ...(line.snapshot?.stationId
          ? [
              this.client.invalidateQueries({
                queryKey: kitchenKeys.station(kitchen, line.snapshot.stationId),
              }),
            ]
          : [
              // The cancellation DTO does not expose captured stock targets. Mark only this
              // actor/Outlet's existing Inventory family stale; no mapping lookups/fan-out.
              this.client.invalidateQueries({
                queryKey: [
                  ...inventoryKeys.root(stock).slice(0, -1),
                  { user: ctx.user, revision: ctx.revision },
                ],
              }),
            ]),
      ]),
    );
  }
}
