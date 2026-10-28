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
import { inventoryKeys } from './restaurant-inventory.keys';
import {
  compareId,
  CursorData,
  mergeConfirmedRow,
  newestVersion,
} from '../../../core/query-cache/confirmed-pages';
export { inventoryKeys } from './restaurant-inventory.keys';
const needsReconciliation = (error: unknown) =>
  error instanceof HttpErrorResponse &&
  (error.status === 0 || error.status === 408 || error.status === 409 || error.status >= 500);

@Injectable({ providedIn: 'root' })
export class RestaurantInventoryQueries {
  readonly api = inject(RestaurantInventoryApi);
  private readonly client = inject(QueryClient);
  tracking(ctx: InventoryContext, category: string, menuItem: string, enabled: boolean) {
    return queryOptions({
      queryKey: inventoryKeys.tracking(ctx, category, menuItem),
      queryFn: async () => {
        const result = await this.api.tracking(ctx, category, menuItem);
        if (!result.stockItem) return result;
        // A mapping read may have started before a confirmed StockItem edit.
        const stockItem = this.client
          .getQueriesData<C.StockItemResponseData>({
            queryKey: inventoryKeys.itemFamily(ctx, result.stockItem.id),
          })
          .reduce(
            (latest, [, item]) => (item ? newestVersion(latest, item) : latest),
            result.stockItem,
          );
        return { ...result, stockItem };
      },
      enabled: enabled && !!menuItem,
      staleTime: 15_000,
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
    let dispatched = false;
    try {
      const result = await this.api.tracking(ctx, category, menuItem, command, () => {
        dispatched = true;
        onDispatched?.();
      });
      this.api.assertCurrent(ctx);
      const key = inventoryKeys.tracking(ctx, category, menuItem);
      await this.client.cancelQueries({ queryKey: key, exact: true });
      this.api.assertCurrent(ctx);
      this.client.setQueryData<C.InventoryTracking>(key, (previous) =>
        newestVersion(previous, result),
      );
      if (result.stockItem)
        await this.acceptItem(
          ctx,
          result.stockItem,
          'mode' in command && command.mode === 'CREATE',
        );
      return result;
    } catch (error) {
      if (dispatched && this.api.isCurrent(ctx))
        await Promise.all([
          this.client.invalidateQueries({
            queryKey: inventoryKeys.tracking(ctx, category, menuItem),
            exact: true,
          }),
          this.client.invalidateQueries({ queryKey: inventoryKeys.itemsFamily(ctx) }),
        ]);
      throw error;
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
  private linkedTracking(ctx: InventoryContext, id: string) {
    return {
      queryKey: inventoryKeys.trackingFamily(ctx),
      predicate: (query: { state: { data: unknown } }) =>
        (query.state.data as C.InventoryTracking | undefined)?.stockItem?.id === id,
    };
  }
  private async acceptItem(ctx: InventoryContext, item: C.StockItemResponseData, created: boolean) {
    await Promise.all([
      this.client.cancelQueries({ queryKey: inventoryKeys.itemsFamily(ctx) }),
      this.client.cancelQueries({ queryKey: inventoryKeys.itemFamily(ctx, item.id) }),
      this.client.cancelQueries(this.linkedTracking(ctx, item.id)),
    ]);
    this.api.assertCurrent(ctx);
    // Equivalent cached representations can already contain a later confirmed version.
    const details = this.client.getQueriesData<C.StockItemResponseData>({
      queryKey: inventoryKeys.itemFamily(ctx, item.id),
    });
    const collections = this.client.getQueriesData<CursorData<C.StockItemResponseData>>({
      queryKey: inventoryKeys.itemsFamily(ctx),
    });
    const tracking = this.client.getQueriesData<C.InventoryTracking>({
      queryKey: inventoryKeys.trackingFamily(ctx),
    });
    for (const candidate of [
      ...details.map(([, data]) => data),
      ...collections.flatMap(
        ([, data]) =>
          data?.pages.flatMap((page) => page.items.filter((row) => row.id === item.id)) ?? [],
      ),
      ...tracking.map(([, data]) => (data?.stockItem?.id === item.id ? data.stockItem : undefined)),
    ])
      if (candidate) item = newestVersion(item, candidate);
    this.client.setQueryData<C.StockItemResponseData>(inventoryKeys.item(ctx, item.id), (old) =>
      newestVersion(old, item),
    );
    this.client.setQueriesData<C.StockItemResponseData>(
      { queryKey: inventoryKeys.itemFamily(ctx, item.id) },
      (old) => newestVersion(old, item),
    );
    this.client.setQueriesData<C.InventoryTracking>(
      { queryKey: inventoryKeys.trackingFamily(ctx) },
      (old) =>
        old?.stockItem?.id === item.id
          ? { ...old, stockItem: newestVersion(old.stockItem, item) }
          : old,
    );
    const invalidations: Promise<unknown>[] = [];
    for (const [key, old] of this.client.getQueriesData<CursorData<C.StockItemResponseData>>({
      queryKey: inventoryKeys.itemsFamily(ctx),
    })) {
      const merged = mergeConfirmedRow(old, item, compareId, { prefer: newestVersion });
      if (merged.data !== old) this.client.setQueryData(key, merged.data);
      if (!old || (created && !merged.represented))
        invalidations.push(this.client.invalidateQueries({ queryKey: key, exact: true }));
    }
    await Promise.all(invalidations);
  }
  async changed(ctx: InventoryContext, id: string, history = false) {
    await Promise.all([
      this.client.invalidateQueries({ queryKey: inventoryKeys.itemsFamily(ctx) }),
      ...(id
        ? [this.client.invalidateQueries({ queryKey: inventoryKeys.itemFamily(ctx, id) })]
        : []),
      ...(id ? [this.client.invalidateQueries(this.linkedTracking(ctx, id))] : []),
      ...(history && id
        ? [this.client.invalidateQueries({ queryKey: inventoryKeys.historyFamily(ctx, id) })]
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
      await this.acceptItem(ctx, result.data, !id);
      return result;
    } catch (error) {
      if (needsReconciliation(error) && this.api.isCurrent(ctx)) await this.changed(ctx, id ?? '');
      throw error;
    }
  }
  async movement(ctx: InventoryContext, id: string, input: C.ManualStockMovementRequest) {
    try {
      const result = await this.api.movement(ctx, id, input);
      this.api.assertCurrent(ctx);
      const filter = { queryKey: inventoryKeys.historyFamily(ctx, id) };
      await this.client.cancelQueries(filter);
      this.api.assertCurrent(ctx);
      const pending: Promise<unknown>[] = [];
      for (const [key, old] of this.client.getQueriesData<CursorData<C.StockMovementResponseData>>(
        filter,
      )) {
        const merged = mergeConfirmedRow(
          old,
          result.data,
          (a, b) => b.createdAt.localeCompare(a.createdAt) || compareId(b, a),
          { insertWithinLoadedRange: true },
        );
        if (merged.data !== old) this.client.setQueryData(key, merged.data);
        if (!merged.represented)
          pending.push(this.client.invalidateQueries({ queryKey: key, exact: true }));
      }
      // Movement is immutable, but its response is not a complete current StockItem/version.
      await Promise.all([this.changed(ctx, id), ...pending]);
      return result;
    } catch (error) {
      if (
        this.api.isCurrent(ctx) &&
        (isInactiveInventoryError(error) || needsReconciliation(error))
      )
        await this.changed(ctx, id, true);
      throw error;
    }
  }
}
