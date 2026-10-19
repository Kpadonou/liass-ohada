import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { environment } from '../../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class RestaurantServicePreparationApi {
  private readonly http = inject(HttpClient);
  private readonly orders = inject(RestaurantOrdersApi);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  async page(ctx: ServiceOrderContext, order: string, cursor?: string) {
    this.orders.assertContext(ctx);
    c.RestaurantIdSchema.parse(order);
    let params = new HttpParams().set('limit', 50);
    if (cursor) params = params.set('cursor', cursor);
    const page = c.PreparationListResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(
            `${this.base}/restaurants/outlets/${ctx.outlet}/orders/${order}/preparation`,
            { params },
          )
          .pipe(timeout(35_000)),
      ),
    );
    this.orders.assertContext(ctx);
    if (
      page.items.some(
        (task) =>
          task.orgId !== ctx.org ||
          task.outletId !== ctx.outlet ||
          task.orderId !== order ||
          task.serviceContext.mode !== 'DINE_IN',
      ) ||
      (cursor && page.nextCursor === cursor)
    )
      throw new Error('Mismatched service preparation context');
    return page;
  }
  async serve(
    ctx: ServiceOrderContext,
    order: string,
    task: c.PreparationRead,
    clientRequestId: string,
  ) {
    this.orders.assertContext(ctx);
    c.PreparationReadSchema.parse(task);
    if (
      task.orgId !== ctx.org ||
      task.outletId !== ctx.outlet ||
      task.orderId !== order ||
      task.state !== 'READY' ||
      task.serviceContext.mode !== 'DINE_IN'
    )
      throw new Error('Mismatched service preparation context');
    const input = c.PreparationTransitionRequestSchema.parse({
      clientRequestId,
      expectedVersion: task.version,
    });
    const result = c.PreparationResponseSchema.parse(
      await firstValueFrom(
        this.http
          .post<unknown>(
            `${this.base}/restaurants/outlets/${ctx.outlet}/orders/${order}/items/${task.itemId}/preparation/${task.fireId}/serve`,
            input,
          )
          .pipe(timeout(35_000)),
      ),
    );
    this.orders.assertContext(ctx);
    if (
      result.data.orgId !== ctx.org ||
      result.data.outletId !== ctx.outlet ||
      result.data.orderId !== order ||
      result.data.itemId !== task.itemId ||
      result.data.fireId !== task.fireId ||
      result.data.state !== 'SERVED'
    )
      throw new Error('Mismatched service preparation result');
    return result;
  }
}
