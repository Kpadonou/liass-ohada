import { Injectable, inject } from '@angular/core';
import { infiniteQueryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import {
  RestaurantPreparationApi,
  KitchenContext,
  KitchenLane,
} from './restaurant-preparation.api';
export const kitchenKeys = {
  scope: (ctx: KitchenContext) =>
    ['restaurants', ctx.org, 'kitchen', ctx.user, ctx.revision, ctx.outlet] as const,
  station: (ctx: KitchenContext, station: string) =>
    [...kitchenKeys.scope(ctx), 'queue', station] as const,
  lane: (ctx: KitchenContext, station: string, state: KitchenLane) =>
    [...kitchenKeys.station(ctx, station), state] as const,
};
@Injectable({ providedIn: 'root' })
export class RestaurantPreparationQueries {
  readonly api = inject(RestaurantPreparationApi);
  private readonly client = inject(QueryClient);
  outlets(ctx: KitchenContext, self: boolean, enabled: boolean) {
    return infiniteQueryOptions({
      queryKey: [...kitchenKeys.scope({ ...ctx, outlet: '' }), 'outlets', self],
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => ({
        ...(await this.api.outlets(ctx, self, pageParam)),
        contextKey: JSON.stringify(ctx),
      }),
      getNextPageParam: (last) => last.nextCursor,
      enabled,
      staleTime: 30_000,
      retry: false,
    });
  }
  stations(ctx: KitchenContext, enabled: boolean) {
    return infiniteQueryOptions({
      queryKey: [...kitchenKeys.scope(ctx), 'stations'],
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => ({
        ...(await this.api.stations(ctx, pageParam)),
        contextKey: JSON.stringify(ctx),
      }),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!ctx.outlet,
      staleTime: 60_000,
      retry: false,
    });
  }
  lane(ctx: KitchenContext, station: string, state: KitchenLane, enabled: boolean) {
    return infiniteQueryOptions({
      queryKey: kitchenKeys.lane(ctx, station, state),
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => ({
        ...(await this.api.queue(ctx, station, state, pageParam)),
        contextKey: JSON.stringify([ctx, station, state]),
      }),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!station && !!ctx.outlet,
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: false,
    });
  }
  reconcile(ctx: KitchenContext, station: string, states: KitchenLane[]) {
    return Promise.all(
      states.map((state) =>
        this.client.invalidateQueries({
          queryKey: kitchenKeys.lane(ctx, station, state),
          exact: true,
        }),
      ),
    );
  }
}
