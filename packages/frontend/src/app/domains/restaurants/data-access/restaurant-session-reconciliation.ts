import { Injectable, signal } from '@angular/core';
import type { ServiceOrderContext } from './restaurant-orders.api';

/** Only a successful domain command may retain its current session during reconciliation.
 * Initial loads and independent authorization refreshes continue to hide cached context.
 */
@Injectable({ providedIn: 'root' })
export class RestaurantSessionReconciliation {
  private readonly active = signal<ReadonlyMap<string, number>>(new Map());
  private key(context: ServiceOrderContext) {
    return JSON.stringify([
      context.org,
      context.user,
      context.revision,
      context.outlet,
      context.session,
    ]);
  }
  contains(context: ServiceOrderContext) {
    return this.active().has(this.key(context));
  }
  async run<T>(context: ServiceOrderContext, reconcile: () => Promise<T>): Promise<T> {
    const key = this.key(context);
    this.active.update((current) => new Map(current).set(key, (current.get(key) ?? 0) + 1));
    try {
      return await reconcile();
    } finally {
      // invalidateQueries resolves before TanStack's batched observer notification.
      // Keep the command scope alive until Angular has received the settled state;
      // otherwise isFetching briefly remains true without its reconciliation scope.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.active.update((current) => {
        const next = new Map(current);
        const count = (next.get(key) ?? 1) - 1;
        if (count) next.set(key, count);
        else next.delete(key);
        return next;
      });
    }
  }
}
