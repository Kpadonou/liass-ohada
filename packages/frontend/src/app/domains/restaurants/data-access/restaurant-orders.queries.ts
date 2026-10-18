import { RestaurantSessionReconciliation } from './restaurant-session-reconciliation';
import { Injectable, inject } from '@angular/core';
import {
  infiniteQueryOptions,
  queryOptions,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { RestaurantsApi } from './restaurants.api';
import { restaurantKeys } from './restaurants.queries';
import { RestaurantContext, RestaurantListKind } from './restaurants-model';
@Injectable({ providedIn: 'root' })
export class RestaurantOrdersQueries {
  readonly api = inject(RestaurantOrdersApi);
  private readonly reconciliation = inject(RestaurantSessionReconciliation);
  private readonly menuApi = inject(RestaurantsApi);
  private readonly client = inject(QueryClient);
  key(ctx: ServiceOrderContext, kind: string, parent = '') {
    return restaurantKeys.serviceOrder(
      ctx.org,
      ctx.user,
      ctx.outlet,
      ctx.session,
      ctx.revision,
      kind,
      parent,
    );
  }
  private pages<T extends { nextCursor?: string }>(
    ctx: ServiceOrderContext,
    kind: string,
    parent: string,
    enabled: boolean,
    fetch: (cursor?: string) => Promise<T>,
  ) {
    return infiniteQueryOptions({
      queryKey: this.key(ctx, kind, parent),
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => {
        this.api.assertContext(ctx);
        const result = await fetch(pageParam);
        this.api.assertContext(ctx);
        if (pageParam && result.nextCursor === pageParam) throw new Error('Repeated cursor');
        return result;
      },
      getNextPageParam: (last) => last.nextCursor,
      enabled,
      staleTime: kind === 'category' || kind === 'item' ? 60_000 : 0,
      retry: false,
      refetchOnWindowFocus: true,
    });
  }
  orders(ctx: ServiceOrderContext, enabled: boolean) {
    return this.pages(ctx, 'orders', '', enabled, (cursor) => this.api.orders(ctx, cursor));
  }
  items(ctx: ServiceOrderContext, order: string, enabled: boolean) {
    return this.pages(ctx, 'items', order, enabled && !!order, (cursor) =>
      this.api.items(ctx, order, cursor),
    );
  }
  order(ctx: ServiceOrderContext, order: string, enabled: boolean) {
    return queryOptions({
      queryKey: this.key(ctx, 'order', order),
      queryFn: () => this.api.order(ctx, order),
      enabled: enabled && !!order,
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: true,
    });
  }
  menu(ctx: ServiceOrderContext, enabled: boolean) {
    return queryOptions({
      queryKey: restaurantKeys.carteMenu(ctx.org, ctx.user, ctx.revision, ctx.outlet),
      queryFn: async () => {
        this.api.assertContext(ctx);
        const menu = await this.menuApi.get(ctx.org, 'menu', { outletId: ctx.outlet });
        this.api.assertContext(ctx);
        if (menu && menu.outletId !== ctx.outlet) throw new Error('Mismatched menu');
        return menu;
      },
      enabled,
      retry: false,
      staleTime: 300_000,
      gcTime: 900_000,
    });
  }
  menuPages<K extends Extract<RestaurantListKind, 'category' | 'item'>>(
    ctx: ServiceOrderContext,
    kind: K,
    category: string,
    enabled: boolean,
  ) {
    const parent: RestaurantContext = {
      outletId: ctx.outlet,
      ...(kind === 'item' ? { categoryId: category } : {}),
    };
    return this.pages(
      ctx,
      kind,
      category,
      enabled && (kind !== 'item' || !!category),
      async (cursor) => {
        const page = await this.menuApi.list(ctx.org, kind, parent, cursor);
        if (
          page.items.some(
            (item) =>
              item.outletId !== ctx.outlet ||
              ('categoryId' in item && item.categoryId !== category),
          )
        )
          throw new Error('Mismatched menu context');
        return page;
      },
    );
  }
  async draftName(ctx: ServiceOrderContext, category: string, item: string) {
    return this.client.fetchQuery({
      queryKey: this.key(ctx, 'draft-name', category + ':' + item),
      queryFn: async () => {
        this.api.assertContext(ctx);
        const result = await this.menuApi.get(
          ctx.org,
          'item',
          { outletId: ctx.outlet, categoryId: category },
          item,
        );
        this.api.assertContext(ctx);
        if (
          result &&
          (result.id !== item || result.outletId !== ctx.outlet || result.categoryId !== category)
        )
          throw new Error('Mismatched draft reference');
        return result?.name ?? '';
      },
      staleTime: 60_000,
      retry: false,
    });
  }
  async changed(
    ctx: ServiceOrderContext,
    order?: string,
    financial = false,
    retainSession = false,
  ) {
    const reconcile = () =>
      Promise.all([
        this.client.invalidateQueries({ queryKey: this.key(ctx, 'orders'), exact: true }),
        ...(order
          ? ['order', 'items'].map((kind) =>
              this.client.invalidateQueries({ queryKey: this.key(ctx, kind, order), exact: true }),
            )
          : []),
        ...(financial
          ? [
              this.client.invalidateQueries({
                queryKey: restaurantKeys.session(ctx.org, ctx.outlet, ctx.session, ctx.user),
                exact: true,
              }),
              this.client.invalidateQueries({
                queryKey: restaurantKeys.floor(ctx.org, ctx.outlet),
                exact: true,
              }),
            ]
          : []),
      ]);
    if (financial && retainSession) await this.reconciliation.run(ctx, reconcile);
    else await reconcile();
  }
  async menuChanged(ctx: ServiceOrderContext, category: string) {
    await this.client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'restaurants' &&
        query.queryKey[1] === ctx.org &&
        ['operational-carte', 'operational-menu'].includes(String(query.queryKey[2])) &&
        query.queryKey[5] === ctx.outlet,
    });
    await Promise.all(
      ['menu', 'category', 'item', 'draft-name'].map((kind) =>
        this.client.invalidateQueries({
          queryKey:
            kind === 'draft-name'
              ? this.key(ctx, kind).slice(0, -1)
              : this.key(ctx, kind, kind === 'item' ? category : ''),
          exact: kind !== 'draft-name',
        }),
      ),
    );
  }
}
