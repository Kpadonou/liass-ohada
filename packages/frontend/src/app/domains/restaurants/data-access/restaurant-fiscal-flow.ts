import { Injectable, inject } from '@angular/core';
import { RestaurantFiscalApi } from './restaurant-fiscal.api';
import { ServiceOrderContext } from './restaurant-orders.api';

type Intent = {
  attemptId: string;
  createCommandId: string;
  confirmCommandId: string;
  createDispatched: boolean;
  confirmDispatched: boolean;
};

/** One-shot application orchestration. Provider uncertainty is read-only until operator recovery. */
@Injectable({ providedIn: 'root' })
export class RestaurantFiscalFlow {
  private readonly api = inject(RestaurantFiscalApi);
  private readonly intents = new Map<string, Intent>();
  private key(ctx: ServiceOrderContext, invoiceId: string) {
    return JSON.stringify([ctx.org, ctx.user, ctx.revision, ctx.outlet, ctx.session, invoiceId]);
  }
  async resume(ctx: ServiceOrderContext, invoiceId: string) {
    const key = this.key(ctx, invoiceId);
    const intent = this.intents.get(key) ?? {
      attemptId: crypto.randomUUID(),
      createCommandId: crypto.randomUUID(),
      confirmCommandId: crypto.randomUUID(),
      createDispatched: false,
      confirmDispatched: false,
    };
    this.intents.set(key, intent);
    let state = await this.api.status(ctx, invoiceId);
    if (state.status === 'NOT_STARTED') {
      if (intent.createDispatched) return state;
      intent.createDispatched = true;
      state = await this.api.initiate(ctx, invoiceId, intent.attemptId, intent.createCommandId);
    }
    if (state.status === 'CREATED') {
      if (intent.confirmDispatched) return state;
      intent.confirmDispatched = true;
      const result = await this.api.confirm(ctx, invoiceId, intent.confirmCommandId);
      if (result.status === 'CONFIRMED') this.intents.delete(key);
      return result;
    }
    if (state.status === 'CONFIRMED') this.intents.delete(key);
    return state;
  }
}
