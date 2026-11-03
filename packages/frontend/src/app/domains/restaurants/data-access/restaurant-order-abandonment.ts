import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient, type InfiniteData } from '@tanstack/angular-query-experimental';
import type { z } from 'zod';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersQueries } from './restaurant-orders.queries';
import { ServiceOrderContext } from './restaurant-orders.api';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { RestaurantSessionReconciliation } from './restaurant-session-reconciliation';
import { restaurantKeys } from './restaurants.queries';
import { inventoryKeys } from './restaurant-inventory.keys';

type Intent = z.infer<typeof c.CancelRestaurantOrderRequestSchema>;
export const orderAbandonable = (order: c.RestaurantOrder) =>
  order.status === 'SUBMITTED' && order.resolutionKind !== 'TECHNICAL_EMPTY_DRAFT';
export const definiteAbandonmentRejection = (error: unknown): error is HttpErrorResponse =>
  error instanceof HttpErrorResponse &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408;

/** Only unresolved command intents live here; TanStack owns all canonical records. */
@Injectable({ providedIn: 'root' })
export class RestaurantOrderAbandonment {
  private readonly queries = inject(RestaurantOrdersQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly client = inject(QueryClient);
  private readonly sessions = inject(RestaurantSessionReconciliation);
  private readonly intents = new Map<string, Intent>();
  private readonly busy = new Set<string>();
  private key(ctx: ServiceOrderContext, order: string) {
    return JSON.stringify([ctx.org, ctx.user, ctx.revision, ctx.outlet, ctx.session, order]);
  }
  pending(ctx: ServiceOrderContext, order: string) {
    return this.intents.get(this.key(ctx, order));
  }
  async abandon(ctx: ServiceOrderContext, order: c.RestaurantOrder, reason: string) {
    this.queries.api.assertContext(ctx);
    if (!this.caps.canManageSetup()) throw new HttpErrorResponse({ status: 403 });
    if (
      order.orgId !== ctx.org ||
      order.outletId !== ctx.outlet ||
      order.guestSessionId !== ctx.session
    )
      throw new Error('Mismatched abandonment context');
    const key = this.key(ctx, order.orderId);
    if (this.busy.has(key)) throw new Error('Abandonment pending');
    let intent = this.intents.get(key);
    if (!intent) {
      if (!orderAbandonable(order)) throw new HttpErrorResponse({ status: 409 });
      intent = c.CancelRestaurantOrderRequestSchema.parse({
        clientRequestId: crypto.randomUUID(),
        expectedVersion: order.version,
        reason,
      });
      this.intents.set(key, intent);
    }
    this.busy.add(key);
    try {
      let result: c.RestaurantOrder;
      try {
        result = c.RestaurantOrderSchema.parse(
          await this.queries.api.abandon(ctx, order.orderId, intent),
        );
        this.queries.api.assertContext(ctx);
        if (
          result.orderId !== order.orderId ||
          result.orgId !== ctx.org ||
          result.outletId !== ctx.outlet ||
          result.guestSessionId !== ctx.session ||
          result.status !== 'CANCELLED'
        )
          throw new Error('Invalid abandonment response');
        this.intents.delete(key);
      } catch (error) {
        if (definiteAbandonmentRejection(error)) this.intents.delete(key);
        throw error;
      }
      // Only replace the confirmed Order. Never calculate a session count or release occupancy.
      await this.client.cancelQueries({
        queryKey: this.queries.key(ctx, 'order', order.orderId),
        exact: true,
      });
      await this.client.cancelQueries({ queryKey: this.queries.key(ctx, 'orders'), exact: true });
      this.queries.api.assertContext(ctx);
      this.client.setQueryData(this.queries.key(ctx, 'order', order.orderId), result);
      this.client.setQueryData<InfiniteData<{ items: c.RestaurantOrder[]; nextCursor?: string }>>(
        this.queries.key(ctx, 'orders'),
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((row) => (row.orderId === result.orderId ? result : row)),
            })),
          },
      );
      // A refresh failure must not turn a confirmed business success into an ambiguous command.
      await this.reconcile(ctx, order.orderId, true).catch(() => undefined);
      return result;
    } finally {
      this.busy.delete(key);
    }
  }
  async reconcile(ctx: ServiceOrderContext, order: string, confirmed = false) {
    this.queries.api.assertContext(ctx);
    await this.sessions.run(ctx, () =>
      Promise.all([
        ...[
          restaurantKeys.session(ctx.org, ctx.outlet, ctx.session, ctx.user, ctx.revision),
          restaurantKeys.floor(ctx.org, ctx.outlet),
          ...(!confirmed
            ? [this.queries.key(ctx, 'orders'), this.queries.key(ctx, 'order', order)]
            : []),
        ].map((queryKey) => this.client.invalidateQueries({ queryKey, exact: true })),
        // Stock targets are server-owned. Stale only this actor/Outlet's existing family.
        this.client.invalidateQueries({
          queryKey: [
            ...inventoryKeys.root({ ...ctx, identity: '' }).slice(0, -1),
            { user: ctx.user, revision: ctx.revision },
          ],
        }),
      ]),
    );
  }
}
