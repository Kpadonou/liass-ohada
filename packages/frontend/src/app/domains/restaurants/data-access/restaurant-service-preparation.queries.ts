import { Injectable, inject } from '@angular/core';
import { infiniteQueryOptions, QueryClient } from '@tanstack/angular-query-experimental';
import { ServiceOrderContext } from './restaurant-orders.api';
import { RestaurantServicePreparationApi } from './restaurant-service-preparation.api';
export const servicePreparationKey = (ctx: ServiceOrderContext, order: string) =>
  [
    'restaurants',
    ctx.org,
    'service-preparation',
    ctx.user,
    ctx.revision,
    ctx.outlet,
    order,
  ] as const;
@Injectable({ providedIn: 'root' })
export class RestaurantServicePreparationQueries {
  readonly api = inject(RestaurantServicePreparationApi);
  private readonly client = inject(QueryClient);
  pages(ctx: ServiceOrderContext, order: string, enabled: boolean) {
    return infiniteQueryOptions({
      queryKey: servicePreparationKey(ctx, order),
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => ({
        ...(await this.api.page(ctx, order, pageParam)),
        contextKey: JSON.stringify(servicePreparationKey(ctx, order)),
      }),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!order,
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: false,
    });
  }
  reconcile(ctx: ServiceOrderContext, order: string) {
    return this.client.invalidateQueries(
      { queryKey: servicePreparationKey(ctx, order), exact: true },
      { throwOnError: true },
    );
  }
}
