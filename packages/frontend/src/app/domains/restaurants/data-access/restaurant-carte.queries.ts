import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { infiniteQueryOptions } from '@tanstack/angular-query-experimental';
import { z } from 'zod';
import {
  MenuItemsBrowseResponseSchema,
  normalizeMenuItemSearch,
} from '@liass-ohada/shared/restaurants';
import { RestaurantsApi } from './restaurants.api';
import { restaurantKeys } from './restaurants.queries';
export type CartePage = z.infer<typeof MenuItemsBrowseResponseSchema>;
export type CarteItem = CartePage['items'][number];
export const CARTE_PAGE_BUDGET = 20;
export const CARTE_BYTE_BUDGET = 2 * 1024 * 1024;
export const carteBytes = (pages: CartePage[]) =>
  pages.reduce(
    (bytes, page) => bytes + new TextEncoder().encode(JSON.stringify(page)).byteLength,
    0,
  );
export function carteTokens(name: string) {
  return normalizeMenuItemSearch(name).split(' ').filter(Boolean);
}
export function matchesCarteTokens(tokens: string[], query: string[]) {
  return query.every((word) => tokens.some((token) => token.startsWith(word)));
}
@Injectable({ providedIn: 'root' })
export class RestaurantCarteQueries {
  private readonly api = inject(RestaurantsApi);
  pages(
    ctx: { org: string; user: string; revision: number; outlet: string; menu: string },
    enabled: boolean,
    budget: () => { pages: number; bytes: number } = () => ({
      pages: CARTE_PAGE_BUDGET,
      bytes: CARTE_BYTE_BUDGET,
    }),
    restart: () => void = () => {},
  ) {
    return infiniteQueryOptions({
      queryKey: restaurantKeys.carte(ctx.org, ctx.user, ctx.revision, ctx.outlet, ctx.menu),
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam, signal }) => {
        const page = await this.api.cartePage(ctx, pageParam, signal);
        if (pageParam === undefined) restart();
        return page;
      },
      getNextPageParam: (last, pages) => {
        if (
          last.nextCursor &&
          pages.slice(0, -1).some((page) => page.nextCursor === last.nextCursor)
        )
          throw new Error('Repeated Carte cursor');
        // Also bound automatic refresh of a previously extended traversal.
        // Exhaustiveness is the canonical last.nextCursor, not this scheduler gate.
        if (pages.length >= budget().pages || carteBytes(pages) >= budget().bytes) return undefined;
        return last.nextCursor;
      },
      enabled: enabled && !!ctx.menu,
      staleTime: 5 * 60_000,
      gcTime: 15 * 60_000,
      retry: (count, error) =>
        count < 1 &&
        error instanceof HttpErrorResponse &&
        (error.status === 0 || error.status >= 500),
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    });
  }
}
