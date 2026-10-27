import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ManualStockMovementRequest,
  ManualStockMovementRequestSchema,
} from '@liass-ohada/shared/restaurants';
import { InventoryContext } from './restaurant-inventory.api';
import { RestaurantInventoryQueries } from './restaurant-inventory.queries';
/** Only unresolved command intent is stored here; canonical inventory stays in TanStack Query. */
@Injectable({ providedIn: 'root' })
export class RestaurantInventoryIntent {
  private readonly queries = inject(RestaurantInventoryQueries);
  private readonly intents = new Map<string, ManualStockMovementRequest>();
  private readonly busy = new Set<string>();
  private key(ctx: InventoryContext, id: string) {
    return 'liass.inventory.intent.' + JSON.stringify([ctx.org, ctx.user, ctx.outlet, id]);
  }
  pending(ctx: InventoryContext, id: string) {
    const key = this.key(ctx, id);
    if (this.intents.has(key)) return this.intents.get(key);
    try {
      const value = sessionStorage.getItem(key);
      if (value) {
        const intent = ManualStockMovementRequestSchema.parse(JSON.parse(value));
        this.intents.set(key, intent);
        return intent;
      }
    } catch {
      /* Storage is optional; the in-memory intent still survives dialog retries. */
    }
    return undefined;
  }
  private store(key: string, intent?: ManualStockMovementRequest) {
    if (intent) this.intents.set(key, intent);
    else this.intents.delete(key);
    try {
      if (intent) sessionStorage.setItem(key, JSON.stringify(intent));
      else sessionStorage.removeItem(key);
    } catch {
      /* Preserve in-memory retry identity when browser storage is unavailable. */
    }
  }
  async submit(
    ctx: InventoryContext,
    id: string,
    proposal: Omit<ManualStockMovementRequest, 'clientRequestId'>,
  ) {
    this.queries.api.assertCurrent(ctx);
    const key = this.key(ctx, id);
    if (this.busy.has(key)) throw new Error('Inventory command pending');
    const previous = this.pending(ctx, id);
    if (
      previous &&
      (previous.type !== proposal.type ||
        previous.quantity !== proposal.quantity ||
        previous.sourceReference !== proposal.sourceReference)
    )
      throw new Error('Unresolved inventory intent');
    const intent =
      previous ??
      ManualStockMovementRequestSchema.parse({ ...proposal, clientRequestId: crypto.randomUUID() });
    this.store(key, intent);
    this.busy.add(key);
    try {
      const result = await this.queries.movement(ctx, id, intent);
      this.store(key);
      return result;
    } catch (error) {
      if (
        !previous &&
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 409].includes(error.status)
      )
        this.store(key);
      throw error;
    } finally {
      this.busy.delete(key);
    }
  }
}
