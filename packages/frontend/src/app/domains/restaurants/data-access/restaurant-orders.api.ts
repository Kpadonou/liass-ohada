import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import * as c from '@liass-ohada/shared/restaurants';
import { AuthStore } from '../../identity/data-access/auth.store';
import { environment } from '../../../../environments/environment';

export interface ServiceOrderContext {
  org: string;
  user: string;
  revision: number;
  outlet: string;
  session: string;
}
export const orderCommands = {
  create: c.CreateRestaurantOrderRequestSchema,
  add: c.AddRestaurantDraftItemRequestSchema,
  edit: c.EditRestaurantDraftItemRequestSchema,
  remove: c.CancelRestaurantItemRequestSchema,
  submit: c.SubmitRestaurantOrderRequestSchema,
};
export type OrderCommand = keyof typeof orderCommands;
@Injectable({ providedIn: 'root' })
export class RestaurantOrdersApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  assertContext(ctx: ServiceOrderContext) {
    if (
      !ctx.user ||
      this.auth.effectiveOrgId() !== ctx.org ||
      this.auth.currentUserId() !== ctx.user ||
      (this.auth.contextRevision?.() ?? 0) !== ctx.revision
    )
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
    c.RestaurantIdSchema.parse(ctx.outlet);
    c.RestaurantIdSchema.parse(ctx.session);
  }
  private path(ctx: ServiceOrderContext) {
    this.assertContext(ctx);
    return this.base + `/restaurants/outlets/${ctx.outlet}`;
  }
  private owned<T extends { orgId: string; outletId: string; guestSessionId?: string }>(
    ctx: ServiceOrderContext,
    value: T,
  ): T {
    this.assertContext(ctx);
    if (
      value.orgId !== ctx.org ||
      value.outletId !== ctx.outlet ||
      value.guestSessionId !== ctx.session
    )
      throw new Error('Mismatched session ownership');
    return value;
  }
  async orders(ctx: ServiceOrderContext, cursor?: string) {
    const response = c.RestaurantOrderListResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(this.path(ctx) + `/sessions/${ctx.session}/orders`, {
            params: this.params(cursor),
          })
          .pipe(timeout(35_000)),
      ),
    );
    response.items.forEach((order) => this.owned(ctx, order));
    this.assertContext(ctx);
    return response;
  }
  async order(ctx: ServiceOrderContext, order: string) {
    c.RestaurantIdSchema.parse(order);
    const response = c.RestaurantOrderResponseSchema.parse(
      await firstValueFrom(
        this.http.get<unknown>(this.path(ctx) + `/orders/${order}`).pipe(timeout(35_000)),
      ),
    );
    if (response.data.orderId !== order) throw new Error('Mismatched order');
    return this.owned(ctx, response.data);
  }
  async items(ctx: ServiceOrderContext, order: string, cursor?: string) {
    c.RestaurantIdSchema.parse(order);
    const response = c.RestaurantOrderItemListResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(this.path(ctx) + `/orders/${order}/items`, { params: this.params(cursor) })
          .pipe(timeout(35_000)),
      ),
    );
    this.assertContext(ctx);
    if (
      response.items.some(
        (line) => line.orgId !== ctx.org || line.outletId !== ctx.outlet || line.orderId !== order,
      )
    )
      throw new Error('Mismatched items');
    return response;
  }
  private params(cursor?: string) {
    const input = c.RestaurantTransactionListRequestSchema.parse({ limit: 100, cursor });
    return cursor
      ? new HttpParams().set('limit', input.limit).set('cursor', cursor)
      : new HttpParams().set('limit', input.limit);
  }
  async command(
    ctx: ServiceOrderContext,
    command: OrderCommand,
    input: unknown,
    order?: string,
    item?: string,
  ) {
    const request = orderCommands[command].parse(input);
    if (order) c.RestaurantIdSchema.parse(order);
    if (item) c.RestaurantIdSchema.parse(item);
    if (command !== 'create' && !order) throw new Error('Missing order');
    if ((command === 'edit' || command === 'remove') && !item) throw new Error('Missing line');
    const suffix =
      command === 'create'
        ? '/orders'
        : `/orders/${order}` +
          (command === 'submit'
            ? '/submit'
            : '/items' + (item ? `/${item}` : '') + (command === 'remove' ? '/cancel' : ''));
    const url = this.path(ctx) + suffix;
    const raw = await firstValueFrom(
      (command === 'edit'
        ? this.http.patch<unknown>(url, request)
        : this.http.post<unknown>(url, request)
      ).pipe(timeout(35_000)),
    );
    this.assertContext(ctx);
    if (command === 'create' || command === 'submit') {
      const result = this.owned(ctx, c.RestaurantOrderResponseSchema.parse(raw).data);
      if (command === 'submit' && result.orderId !== order) throw new Error('Mismatched order');
      return result;
    }
    const result = c.RestaurantOrderItemResponseSchema.parse(raw).data;
    if (
      result.orgId !== ctx.org ||
      result.outletId !== ctx.outlet ||
      result.orderId !== order ||
      (item && result.itemId !== item)
    )
      throw new Error('Mismatched item');
    return result;
  }
}
