import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { firstValueFrom, timeout, tap, filter, map } from 'rxjs';
import * as C from '@liass-ohada/shared/restaurants';
import { z } from 'zod';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { environment } from '../../../../environments/environment';
import { userMessageFromResponse } from '../../../core/notifications/notification-message';

export interface InventoryContext {
  org: string;
  user: string;
  revision: number;
  outlet: string;
  identity: string;
}
@Injectable({ providedIn: 'root' })
export class RestaurantInventoryApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly outlet = inject(RestaurantOutletContext);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  context(configurationOutlet?: string): InventoryContext {
    return {
      org: this.auth.effectiveOrgId() ?? '',
      user: this.auth.currentUserId() ?? '',
      revision: this.auth.contextRevision(),
      outlet: configurationOutlet ?? this.outlet.id(),
      identity: configurationOutlet
        ? `configuration:${configurationOutlet}`
        : this.outlet.identity(),
    };
  }
  isCurrent(ctx: InventoryContext) {
    const now = this.context(
      ctx.identity === `configuration:${ctx.outlet}` ? ctx.outlet : undefined,
    );
    return (
      !!ctx.org &&
      !!ctx.outlet &&
      JSON.stringify(now) === JSON.stringify(ctx) &&
      this.caps.canManageInventory() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE'
    );
  }
  assertCurrent(ctx: InventoryContext) {
    if (!this.isCurrent(ctx))
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
  }
  private path(ctx: InventoryContext, id?: string) {
    this.assertCurrent(ctx);
    return (
      environment.apiBaseUrl.replace(/\/$/, '') +
      `/restaurants/outlets/${C.RestaurantIdSchema.parse(ctx.outlet)}/inventory/items` +
      (id ? `/${C.RestaurantIdSchema.parse(id)}` : '')
    );
  }
  private async request<T>(
    ctx: InventoryContext,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    cursor?: string,
  ) {
    this.assertCurrent(ctx);
    try {
      const response = await firstValueFrom(
        this.http
          .request<unknown>(method, path, {
            body,
            ...(method === 'GET' ? { params: { limit: '50', ...(cursor ? { cursor } : {}) } } : {}),
          })
          .pipe(timeout(30_000)),
      );
      this.assertCurrent(ctx);
      return { data: schema.parse(response), message: userMessageFromResponse(response) };
    } catch (error) {
      this.assertCurrent(ctx);
      throw error;
    }
  }
  async items(ctx: InventoryContext, cursor?: string) {
    return (
      await this.request(ctx, 'GET', this.path(ctx), C.StockItemsResponseSchema, undefined, cursor)
    ).data;
  }
  async item(ctx: InventoryContext, id: string) {
    // The single-item contract has no pagination parameters.
    this.assertCurrent(ctx);
    try {
      const result = C.StockItemResponseSchema.parse(
        await firstValueFrom(this.http.get<unknown>(this.path(ctx, id)).pipe(timeout(30_000))),
      );
      this.assertCurrent(ctx);
      if (result.data.id !== id) throw new Error('Inventory identity mismatch');
      return result.data;
    } catch (error) {
      this.assertCurrent(ctx);
      throw error;
    }
  }
  async history(ctx: InventoryContext, id: string, cursor?: string) {
    const page = (
      await this.request(
        ctx,
        'GET',
        this.path(ctx, id) + '/movements',
        C.StockMovementsResponseSchema,
        undefined,
        cursor,
      )
    ).data;
    if (page.items.some((m) => m.stockItemId !== id)) throw new Error('Inventory history mismatch');
    return page;
  }
  async create(ctx: InventoryContext, input: C.CreateStockItemRequest) {
    const r = await this.request(
      ctx,
      'POST',
      this.path(ctx),
      C.StockItemResponseSchema,
      C.CreateStockItemRequestSchema.parse(input),
    );
    return { data: r.data.data, message: r.message };
  }
  async update(ctx: InventoryContext, id: string, input: C.UpdateStockItemRequest) {
    const r = await this.request(
      ctx,
      'PATCH',
      this.path(ctx, id),
      C.StockItemResponseSchema,
      C.UpdateStockItemRequestSchema.parse(input),
    );
    if (r.data.data.id !== id) throw new Error('Inventory identity mismatch');
    return { data: r.data.data, message: r.message };
  }
  async movement(ctx: InventoryContext, id: string, input: C.ManualStockMovementRequest) {
    const r = await this.request(
      ctx,
      'POST',
      this.path(ctx, id) + '/movements',
      C.StockMovementResponseSchema,
      C.ManualStockMovementRequestSchema.parse(input),
    );
    if (r.data.data.stockItemId !== id) throw new Error('Inventory identity mismatch');
    return { data: r.data.data, message: r.message };
  }
  async tracking(
    ctx: InventoryContext,
    categoryId: string,
    menuItemId: string,
    command?: C.SaveInventoryTrackingRequest | C.RemoveInventoryTrackingRequest,
    onDispatched?: () => void,
  ) {
    this.assertCurrent(ctx);
    const path =
      environment.apiBaseUrl.replace(/\/$/, '') +
      `/restaurants/outlets/${C.RestaurantIdSchema.parse(ctx.outlet)}/inventory/menu-items/${C.RestaurantIdSchema.parse(menuItemId)}/tracking`;
    try {
      const method = !command ? 'GET' : 'mode' in command ? 'PUT' : 'DELETE';
      const body =
        command &&
        ('mode' in command
          ? C.SaveInventoryTrackingRequestSchema
          : C.RemoveInventoryTrackingRequestSchema
        ).parse(command);
      const result = C.InventoryTrackingResponseSchema.parse(
        await firstValueFrom(
          this.http
            .request<unknown>(method, path, {
              ...(command
                ? { body }
                : { params: { categoryId: C.RestaurantIdSchema.parse(categoryId) } }),
              observe: 'events',
            })
            .pipe(
              tap((event) => {
                if (event.type === HttpEventType.Sent) onDispatched?.();
              }),
              filter((event): event is HttpResponse<unknown> => event instanceof HttpResponse),
              map((event) => event.body),
              timeout(30_000),
            ),
        ),
      );
      this.assertCurrent(ctx);
      if (result.data.menuItemId !== menuItemId)
        throw new Error('Inventory tracking identity mismatch');
      return result.data;
    } catch (error) {
      this.assertCurrent(ctx);
      throw error;
    }
  }
}
