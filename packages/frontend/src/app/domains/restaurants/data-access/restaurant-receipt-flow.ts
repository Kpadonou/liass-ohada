import { Injectable, inject } from '@angular/core';
import { RestaurantReceiptApi, ReceiptProgress } from './restaurant-receipt.api';
import { ServiceOrderContext } from './restaurant-orders.api';
export const receiptKey = (ctx: ServiceOrderContext) =>
  [
    'restaurants',
    'receipt',
    ctx.org,
    ctx.user,
    ctx.revision,
    ctx.outlet,
    ctx.session,
    'FINAL',
  ] as const;
/** Intent/progress orchestration only. FINAL data and pages belong to TanStack Query. */
@Injectable({ providedIn: 'root' })
export class RestaurantReceiptFlow {
  private readonly api = inject(RestaurantReceiptApi);
  private readonly intents = new Map<string, string>();
  private readonly running = new Set<string>();
  async resume(
    ctx: ServiceOrderContext,
    current: () => boolean,
    progress: (p: ReceiptProgress) => void,
  ) {
    const key = JSON.stringify(receiptKey(ctx));
    if (this.running.has(key)) return false;
    const id = this.intents.get(key) ?? crypto.randomUUID();
    this.intents.set(key, id);
    this.running.add(key);
    let prior = 0,
      stalled = 0;
    try {
      // A bounded foreground command sequence, never interval polling. Manual resume keeps the intent.
      for (let step = 0; step < 12 && current(); step++) {
        this.api.assertContext(ctx);
        const value = await this.api.publish(ctx, id);
        if (!current()) return false;
        progress(value);
        if (value.state === 'FINAL') return true;
        if (value.version <= prior) stalled++;
        else stalled = 0;
        prior = value.version;
        if (stalled >= 2) return false;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return false;
    } finally {
      this.running.delete(key);
    }
  }
}
