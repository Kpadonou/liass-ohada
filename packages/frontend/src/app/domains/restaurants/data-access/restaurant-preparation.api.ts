import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import * as c from '@liass-ohada/shared/restaurants';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { environment } from '../../../../environments/environment';
export interface KitchenContext {
  org: string;
  user: string;
  revision: number;
  outlet: string;
}
export type KitchenLane = 'QUEUED' | 'IN_PROGRESS' | 'READY';
export type KitchenTask = c.PreparationRead;
@Injectable({ providedIn: 'root' })
export class RestaurantPreparationApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly config = inject(RestaurantsApi);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  context(): KitchenContext {
    return {
      org: this.auth.effectiveOrgId() ?? '',
      user: this.auth.currentUserId() ?? '',
      revision: this.auth.contextRevision?.() ?? 0,
      outlet: '',
    };
  }
  assert(ctx: KitchenContext) {
    if (
      !ctx.user ||
      ctx.org !== this.auth.effectiveOrgId() ||
      ctx.user !== this.auth.currentUserId() ||
      ctx.revision !== (this.auth.contextRevision?.() ?? 0)
    )
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
  }
  async outlets(ctx: KitchenContext, self: boolean, cursor?: string) {
    this.assert(ctx);
    const page = self
      ? await this.config.myOutlets(ctx.org, ctx.user, cursor)
      : await this.config.list(ctx.org, 'outlet', {}, cursor);
    this.assert(ctx);
    return {
      items: page.items.map((row) =>
        'outletId' in row ? { id: row.outletId, name: row.name, isActive: true } : row,
      ),
      nextCursor: page.nextCursor,
    };
  }
  async stations(ctx: KitchenContext, cursor?: string) {
    this.assert(ctx);
    c.RestaurantIdSchema.parse(ctx.outlet);
    const page = await this.config.list(ctx.org, 'station', { outletId: ctx.outlet }, cursor);
    this.assert(ctx);
    if (page.items.some((row) => row.outletId !== ctx.outlet))
      throw new Error('Mismatched station context');
    return page;
  }
  async queue(ctx: KitchenContext, station: string, state: KitchenLane, cursor?: string) {
    this.assert(ctx);
    c.RestaurantIdSchema.parse(ctx.outlet);
    c.RestaurantIdSchema.parse(station);
    const input = c.RestaurantTransactionListRequestSchema.parse({ limit: 50, cursor });
    let params = new HttpParams().set('limit', input.limit);
    if (cursor) params = params.set('cursor', cursor);
    const page = c.PreparationListResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(
            this.base +
              `/restaurants/outlets/${ctx.outlet}/preparation-stations/${station}/work/${state}`,
            { params },
          )
          .pipe(timeout(35_000)),
      ),
    );
    this.assert(ctx);
    if (
      page.items.some(
        (task) =>
          task.orgId !== ctx.org ||
          task.outletId !== ctx.outlet ||
          task.stationId !== station ||
          task.state !== state,
      ) ||
      (cursor && page.nextCursor === cursor)
    )
      throw new Error('Mismatched preparation context');
    return page;
  }
  async command(
    ctx: KitchenContext,
    task: KitchenTask,
    action: 'start' | 'ready',
    clientRequestId: string,
  ) {
    this.assert(ctx);
    if (task.orgId !== ctx.org || task.outletId !== ctx.outlet)
      throw new Error('Mismatched preparation context');
    const input = c.PreparationTransitionRequestSchema.parse({
      clientRequestId,
      expectedVersion: task.version,
    });
    const result = c.PreparationResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(
            this.base +
              `/restaurants/outlets/${ctx.outlet}/orders/${task.orderId}/items/${task.itemId}/preparation/${task.fireId}/${action}`,
            input,
          )
          .pipe(timeout(35_000)),
      ),
    );
    this.assert(ctx);
    const next = action === 'start' ? 'IN_PROGRESS' : 'READY';
    const value = result.data;
    if (
      value.orgId !== ctx.org ||
      value.outletId !== ctx.outlet ||
      value.orderId !== task.orderId ||
      value.itemId !== task.itemId ||
      value.fireId !== task.fireId ||
      value.stationId !== task.stationId ||
      value.state !== next
    )
      throw new Error('Mismatched preparation command');
    return result;
  }
}
