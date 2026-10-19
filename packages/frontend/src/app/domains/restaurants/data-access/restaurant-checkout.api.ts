import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RestaurantCheckoutApi {
  private readonly http = inject(HttpClient);
  private readonly orders = inject(RestaurantOrdersApi);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');
  private async post(ctx: ServiceOrderContext, suffix: string, request: unknown) {
    this.orders.assertContext(ctx);
    c.RestaurantIdSchema.parse(ctx.outlet);
    const raw = await firstValueFrom(
      this.http
        .post<unknown>(this.base + `/restaurants/outlets/${ctx.outlet}` + suffix, request)
        .pipe(timeout(35_000)),
    );
    this.orders.assertContext(ctx);
    return raw;
  }
  async capture(ctx: ServiceOrderContext, request: c.CaptureRestaurantPaymentRequest) {
    const input = c.CaptureRestaurantPaymentRequestSchema.parse(request);
    const result = c.RestaurantPaymentResponseSchema.parse(
      await this.post(ctx, `/sessions/${ctx.session}/payments`, input),
    ).data;
    if (
      result.orgId !== ctx.org ||
      result.outletId !== ctx.outlet ||
      result.guestSessionId !== ctx.session ||
      result.clientRequestId !== input.clientRequestId
    )
      throw new Error('Mismatched payment');
    return result;
  }
  async closeOrder(
    ctx: ServiceOrderContext,
    order: string,
    request: { clientRequestId: string; expectedVersion: number },
  ) {
    c.RestaurantIdSchema.parse(order);
    const result = c.RestaurantOrderResponseSchema.parse(
      await this.post(
        ctx,
        `/orders/${order}/close`,
        c.CloseRestaurantOrderRequestSchema.parse(request),
      ),
    ).data;
    if (
      result.orgId !== ctx.org ||
      result.outletId !== ctx.outlet ||
      result.guestSessionId !== ctx.session ||
      result.orderId !== order ||
      result.status !== 'CLOSED'
    )
      throw new Error('Mismatched Order closure');
    return result;
  }
  async closeSession(
    ctx: ServiceOrderContext,
    request: { clientRequestId: string; expectedVersion: number },
  ) {
    const result = c.GuestSessionResponseSchema.parse(
      await this.post(
        ctx,
        `/sessions/${ctx.session}/close`,
        c.CloseGuestSessionRequestSchema.parse(request),
      ),
    ).data;
    if (
      result.orgId !== ctx.org ||
      result.outletId !== ctx.outlet ||
      result.guestSessionId !== ctx.session ||
      result.status !== 'CLOSED'
    )
      throw new Error('Mismatched session closure');
    return result;
  }
}
