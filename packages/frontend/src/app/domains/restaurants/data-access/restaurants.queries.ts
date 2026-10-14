import type { InfiniteData } from '@tanstack/angular-query-experimental';
import type { RestaurantServiceFloorResponse } from '@liass-ohada/shared/restaurants';
import { Injectable, inject } from '@angular/core';
import {
  infiniteQueryOptions,
  queryOptions,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantKind, RestaurantListKind, RestaurantContext } from './restaurants-model';
import { ZodError } from 'zod';
import { HttpErrorResponse } from '@angular/common/http';
export const restaurantKeys = {
  floor: (org: string, outletId: string) =>
    ['restaurants', org, 'service-floor', outletId] as const,
  root: (org: string) => ['restaurants', org] as const,
  collection: (org: string, kind: RestaurantKind, ctx: RestaurantContext = {}) =>
    [
      'restaurants',
      org,
      kind,
      ctx.outletId ?? null,
      ctx.areaId ?? null,
      ctx.categoryId ?? null,
    ] as const,
};
const retry = (count: number, error: unknown) =>
  !(error instanceof ZodError) &&
  !(error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500) &&
  count < 1;
@Injectable({ providedIn: 'root' })
export class RestaurantsQueries {
  private readonly api = inject(RestaurantsApi);
  private readonly auth = inject(AuthStore);
  private readonly client = inject(QueryClient);
  scope() {
    return this.auth.effectiveOrgId() ?? '';
  }
  get<K extends RestaurantKind>(kind: K, ctx: RestaurantContext = {}, enabled = true) {
    const org = this.scope();
    return queryOptions({
      queryKey: restaurantKeys.collection(org, kind, ctx),
      queryFn: () => this.api.get(org, kind, ctx),
      enabled: enabled && !!org,
      staleTime: 60_000,
      retry,
    });
  }
  list<K extends RestaurantListKind>(kind: K, ctx: RestaurantContext = {}, enabled = true) {
    const org = this.scope();
    return infiniteQueryOptions({
      queryKey: restaurantKeys.collection(org, kind, ctx),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.list(org, kind, ctx, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org,
      staleTime: 60_000,
      retry,
    });
  }
  detail<K extends RestaurantKind>(kind: K, ctx: RestaurantContext, id: string, enabled = true) {
    const org = this.scope();
    return queryOptions({
      queryKey: [...restaurantKeys.collection(org, kind, ctx), id],
      queryFn: () => this.api.get(org, kind, ctx, id),
      enabled: enabled && !!org && !!id,
      staleTime: 60_000,
      retry,
    });
  }
  serviceFloor(outletId: string, enabled = true) {
    const org = this.scope();
    const queryKey = restaurantKeys.floor(org, outletId);
    return infiniteQueryOptions({
      queryKey,
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => {
        const seen = new Set<string>();
        if (pageParam) seen.add(pageParam);
        let cursor = pageParam;
        for (let hop = 0; hop < 8; hop++) {
          const page = await this.api.serviceFloor(org, outletId, cursor);
          if (page.nextCursor && seen.has(page.nextCursor))
            throw new Error('Invalid floor pagination');
          if (page.items.length || !page.nextCursor) {
            const previous =
              this.client.getQueryData<
                InfiniteData<RestaurantServiceFloorResponse, string | undefined>
              >(queryKey);
            const index = previous?.pageParams.indexOf(pageParam) ?? -1;
            const boundary = index >= 0 ? index : (previous?.pageParams.length ?? 0);
            const nextIndex = page.nextCursor
              ? (previous?.pageParams.indexOf(page.nextCursor) ?? -1)
              : -1;
            if (nextIndex >= 0 && nextIndex <= boundary)
              throw new Error('Invalid floor pagination');
            return page;
          }
          cursor = page.nextCursor;
          seen.add(cursor);
        }
        throw new Error('Floor pagination limit exceeded');
      },
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org && !!outletId,
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  }
  async floorChanged(org: string, outletId: string) {
    await this.client.invalidateQueries({
      queryKey: restaurantKeys.floor(org, outletId),
      exact: true,
    });
  }
  async changed(org: string, kind: RestaurantKind, ctx: RestaurantContext = {}) {
    await this.client.invalidateQueries({ queryKey: restaurantKeys.collection(org, kind, ctx) });
    if (kind === 'table' || kind === 'area' || kind === 'outlet')
      await this.client.invalidateQueries({
        queryKey: ctx.outletId
          ? restaurantKeys.floor(org, ctx.outletId)
          : ['restaurants', org, 'service-floor'],
      });
  }
  async denied(org: string) {
    await this.client.invalidateQueries({ queryKey: ['product-access', org] });
  }
}
