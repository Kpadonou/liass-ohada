import { inject, Injectable } from '@angular/core';
import {
  infiniteQueryOptions,
  queryOptions,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import * as C from '@liass-ohada/shared/restaurants';
import { RestaurantInventoryApi, InventoryContext } from './restaurant-inventory.api';
import { isInactiveInventoryError } from '../utils/inventory-errors';
export const inventoryKeys = {
  tracking: (ctx: InventoryContext, category: string, menuItem: string) =>
    [...inventoryKeys.root(ctx), 'tracking', category, menuItem] as const,
  root: (ctx: InventoryContext) =>
    [
      'restaurants',
      ctx.org,
      'inventory',
      ctx.user,
      ctx.revision,
      ctx.identity,
      ctx.outlet,
    ] as const,
  items: (ctx: InventoryContext) => [...inventoryKeys.root(ctx), 'items'] as const,
  item: (ctx: InventoryContext, id: string) => [...inventoryKeys.root(ctx), 'item', id] as const,
  history: (ctx: InventoryContext, id: string) =>
    [...inventoryKeys.root(ctx), 'history', id] as const,
};
@Injectable({ providedIn: 'root' })
export class RestaurantInventoryQueries {
  readonly api = inject(RestaurantInventoryApi);
  private readonly client = inject(QueryClient);
  tracking(ctx: InventoryContext, category: string, menuItem: string, enabled: boolean) {
    return queryOptions({
      queryKey: inventoryKeys.tracking(ctx, category, menuItem),
      queryFn: () => this.api.tracking(ctx, category, menuItem),
      enabled: enabled && !!menuItem,
      staleTime: 0,
      retry: false,
    });
  }
  async saveTracking(
    ctx: InventoryContext,
    category: string,
    menuItem: string,
    command: C.SaveInventoryTrackingRequest | C.RemoveInventoryTrackingRequest,
    onDispatched?: () => void,
  ) {
    try {
      const result = await this.api.tracking(ctx, category, menuItem, command, onDispatched);
      this.api.assertCurrent(ctx);
      this.client.setQueryData(inventoryKeys.tracking(ctx, category, menuItem), result);
      return result;
    } finally {
      if (this.api.isCurrent(ctx))
        await Promise.all([
          this.client.invalidateQueries({
            queryKey: inventoryKeys.tracking(ctx, category, menuItem),
            exact: true,
          }),
          this.client.invalidateQueries({
            predicate: (q) =>
              q.queryKey[0] === 'restaurants' &&
              q.queryKey[1] === ctx.org &&
              q.queryKey[2] === 'inventory' &&
              q.queryKey[6] === ctx.outlet &&
              q.queryKey[7] === 'items',
          }),
        ]);
    }
  }
  items(ctx: InventoryContext, enabled: boolean) {
    return infiniteQueryOptions({
      queryKey: inventoryKeys.items(ctx),
      queryFn: ({ pageParam }) => this.api.items(ctx, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!ctx.outlet,
      staleTime: 60_000,
      retry: false,
    });
  }
  item(ctx: InventoryContext, id: string, enabled: boolean) {
    return queryOptions({
      queryKey: inventoryKeys.item(ctx, id),
      queryFn: () => this.api.item(ctx, id),
      enabled: enabled && !!id,
      staleTime: 15_000,
      retry: false,
    });
  }
  history(ctx: InventoryContext, id: string, enabled: boolean) {
    return infiniteQueryOptions({
      queryKey: inventoryKeys.history(ctx, id),
      queryFn: ({ pageParam }) => this.api.history(ctx, id, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!id,
      staleTime: 30_000,
      retry: false,
    });
  }
  async changed(ctx: InventoryContext, id: string, history = false) {
    await Promise.all([
      this.client.invalidateQueries({ queryKey: inventoryKeys.items(ctx), exact: true }),
      this.client.invalidateQueries({ queryKey: inventoryKeys.item(ctx, id), exact: true }),
      ...(history
        ? [this.client.invalidateQueries({ queryKey: inventoryKeys.history(ctx, id), exact: true })]
        : []),
    ]);
  }
  async save(
    ctx: InventoryContext,
    id: string | null,
    input: C.CreateStockItemRequest | C.UpdateStockItemRequest,
  ) {
    try {
      const result = id
        ? await this.api.update(ctx, id, C.UpdateStockItemRequestSchema.parse(input))
        : await this.api.create(ctx, C.CreateStockItemRequestSchema.parse(input));
      this.api.assertCurrent(ctx);
      this.client.setQueryData(inventoryKeys.item(ctx, result.data.id), result.data);
      await this.changed(ctx, result.data.id);
      return result;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && this.api.isCurrent(ctx))
        await this.changed(ctx, id ?? '');
      throw error;
    }
  }
  async movement(ctx: InventoryContext, id: string, input: C.ManualStockMovementRequest) {
    try {
      const result = await this.api.movement(ctx, id, input);
      this.api.assertCurrent(ctx);
      await this.changed(ctx, id, true);
      return result;
    } catch (error) {
      if (isInactiveInventoryError(error) && this.api.isCurrent(ctx)) await this.changed(ctx, id);
      throw error;
    }
  }
}
