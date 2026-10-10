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
  async changed(org: string, kind: RestaurantKind, ctx: RestaurantContext = {}) {
    await this.client.invalidateQueries({ queryKey: restaurantKeys.collection(org, kind, ctx) });
  }
  async denied(org: string) {
    await this.client.invalidateQueries({ queryKey: ['product-access', org] });
  }
}
