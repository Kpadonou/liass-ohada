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
  myOutlets: (org: string, user: string) => ['restaurants', org, 'my-outlets', user] as const,
  staff: (org: string) => ['restaurants', org, 'staff'] as const,
  staffMember: (org: string, userId: string) =>
    ['restaurants', org, 'staff-member', userId] as const,
  staffCandidate: (org: string, userId: string) =>
    ['restaurants', org, 'staff-candidate', userId] as const,
  staffOutlets: (org: string, userId: string) =>
    ['restaurants', org, 'staff-outlets', userId] as const,
  outletStaff: (org: string, outletId?: string) =>
    outletId
      ? (['restaurants', org, 'outlet-staff', outletId] as const)
      : (['restaurants', org, 'outlet-staff'] as const),
  session: (org: string, outletId: string, sessionId: string) =>
    ['restaurants', org, 'session', outletId, sessionId] as const,
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
  userScope() {
    return this.auth.currentUserId?.() ?? '';
  }
  myOutlets(enabled = true) {
    const org = this.scope(),
      user = this.userScope();
    return infiniteQueryOptions({
      queryKey: restaurantKeys.myOutlets(org, user),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.myOutlets(org, user, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org && !!user,
      staleTime: 0,
      refetchOnMount: 'always' as const,
      retry: false,
    });
  }
  async refreshMyOutlets(org: string, user: string) {
    await this.client.resetQueries({ queryKey: restaurantKeys.myOutlets(org, user), exact: true });
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
  staff(enabled = true) {
    const org = this.scope();
    return infiniteQueryOptions({
      queryKey: restaurantKeys.staff(org),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.staff(org, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org,
      staleTime: 60_000,
      retry,
    });
  }
  staffMember(userId: string, enabled = true) {
    const org = this.scope();
    return queryOptions({
      queryKey: restaurantKeys.staffMember(org, userId),
      queryFn: () => this.api.staffMember(org, userId),
      enabled: enabled && !!org && !!userId,
      staleTime: 60_000,
      retry,
    });
  }
  staffCandidate(userId: string, enabled = true) {
    const org = this.scope();
    return queryOptions({
      queryKey: restaurantKeys.staffCandidate(org, userId),
      queryFn: async () => {
        try {
          return await this.api.staffMember(org, userId);
        } catch (error) {
          if (error instanceof HttpErrorResponse && error.status === 404) return null;
          throw error;
        }
      },
      enabled: enabled && !!org && !!userId,
      staleTime: 0,
      retry: false,
    });
  }
  staffOutlets(userId: string, enabled = true) {
    const org = this.scope();
    return infiniteQueryOptions({
      queryKey: restaurantKeys.staffOutlets(org, userId),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.staffOutlets(org, userId, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org && !!userId,
      staleTime: 60_000,
      retry,
    });
  }
  outletStaff(outletId: string, enabled = true) {
    const org = this.scope();
    return infiniteQueryOptions({
      queryKey: restaurantKeys.outletStaff(org, outletId),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.outletStaff(org, outletId, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org && !!outletId,
      staleTime: 60_000,
      retry,
    });
  }
  async staffAssignmentsChanged(org: string, userId: string, outletIds: string[]) {
    await Promise.all([
      this.client.invalidateQueries({
        queryKey: restaurantKeys.staffOutlets(org, userId),
        exact: true,
      }),
      ...[...new Set(outletIds)].map((id) =>
        this.client.invalidateQueries({
          queryKey: restaurantKeys.outletStaff(org, id),
          exact: true,
        }),
      ),
    ]);
  }
  async staffChanged(org: string, userId: string) {
    await Promise.all([
      this.client.invalidateQueries({ queryKey: restaurantKeys.staff(org), exact: true }),
      this.client.invalidateQueries({
        queryKey: restaurantKeys.staffMember(org, userId),
        exact: true,
      }),
      this.client.invalidateQueries({
        queryKey: restaurantKeys.staffOutlets(org, userId),
        exact: true,
      }),
      // A staff lifecycle change affects their entry in any cached outlet directory.
      this.client.invalidateQueries({ queryKey: restaurantKeys.outletStaff(org) }),
    ]);
  }
  guestSession(outletId: string, sessionId: string, enabled = true) {
    const org = this.scope();
    return queryOptions({
      queryKey: restaurantKeys.session(org, outletId, sessionId),
      queryFn: () => this.api.guestSession(org, outletId, sessionId),
      enabled: enabled && !!org && !!outletId && !!sessionId,
      staleTime: 0,
      refetchOnMount: 'always',
      retry,
    });
  }
  async responsibilityChanged(
    org: string,
    outletId: string,
    sessionId: string,
    refreshCandidates = false,
  ) {
    await Promise.all([
      this.floorChanged(org, outletId),
      this.client.invalidateQueries({
        queryKey: restaurantKeys.session(org, outletId, sessionId),
        exact: true,
      }),
      ...(refreshCandidates
        ? [
            this.client.invalidateQueries({
              queryKey: restaurantKeys.outletStaff(org, outletId),
              exact: true,
            }),
          ]
        : []),
    ]);
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
