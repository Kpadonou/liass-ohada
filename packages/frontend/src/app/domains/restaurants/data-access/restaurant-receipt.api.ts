import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { environment } from '../../../../environments/environment';
export type ReceiptPage = ReturnType<typeof c.RestaurantReceiptResponseSchema.parse>;
export type ReceiptProgress = ReturnType<
  typeof c.RestaurantReceiptPublicationResponseSchema.parse
>['data'];
@Injectable({ providedIn: 'root' })
export class RestaurantReceiptApi {
  private readonly http = inject(HttpClient);
  private readonly context = inject(RestaurantOrdersApi);
  private path(ctx: ServiceOrderContext) {
    this.context.assertContext(ctx);
    return (
      environment.apiBaseUrl.replace(/\/$/, '') +
      `/restaurants/outlets/${ctx.outlet}/sessions/${ctx.session}/receipt`
    );
  }
  assertContext(ctx: ServiceOrderContext) {
    this.context.assertContext(ctx);
  }
  async publish(ctx: ServiceOrderContext, clientRequestId: string) {
    const request = c.PublishRestaurantReceiptRequestSchema.parse({ clientRequestId });
    const result = c.RestaurantReceiptPublicationResponseSchema.parse(
      await firstValueFrom(this.http.post<unknown>(this.path(ctx), request).pipe(timeout(35_000))),
    ).data;
    this.assertContext(ctx);
    if (result.state === 'FINAL' && result.receipt.guestSessionId !== ctx.session)
      throw new Error('Receipt ownership mismatch');
    return result;
  }
  async page(ctx: ServiceOrderContext, cursor?: string, limit = 4): Promise<ReceiptPage> {
    c.RestaurantReceiptReadRequestSchema.parse({ cursor, limit });
    let params = new HttpParams().set('limit', limit);
    if (cursor) params = params.set('cursor', cursor);
    const page = c.RestaurantReceiptResponseSchema.parse(
      await firstValueFrom(
        this.http.get<unknown>(this.path(ctx), { params }).pipe(timeout(35_000)),
      ),
    );
    this.assertContext(ctx);
    if (page.data.guestSessionId !== ctx.session || (page.nextCursor === cursor && cursor))
      throw new Error('Receipt page mismatch');
    return page;
  }
}
