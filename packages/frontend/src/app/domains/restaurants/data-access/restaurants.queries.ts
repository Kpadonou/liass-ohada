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
  carteMenu: (org: string, user: string, revision: number, outlet: string) =>
    ['restaurants', org, 'operational-menu', user, revision, outlet] as const,
  carte: (org: string, user: string, revision: number, outlet: string, menu: string) =>
    ['restaurants', org, 'operational-carte', user, revision, outlet, menu, 'browse-v1'] as const,
  serviceOrder: (
    org: string,
    user: string,
    outlet: string,
    session: string,
    revision: number,
    kind: string,
    parent = '',
  ) =>
    ['restaurants', org, 'service-order', user, outlet, session, revision, kind, parent] as const,
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
  session: (org: string, outletId: string, sessionId: string, user?: string) =>
    [
      'restaurants',
      org,
      'session',
      outletId,
      sessionId,
      ...(user === undefined ? [] : [user]),
    ] as const,
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
  guestRequests(outlet: string, session: string, enabled: boolean) {
    const ctx = { ...this.activityContext(outlet), session };
    return queryOptions({
      queryKey: [
        'restaurants',
        ctx.org,
        'guest-requests',
        ctx.user,
        ctx.revision,
        outlet,
        session,
      ] as const,
      queryFn: async () => {
        const result = await this.api.guestRequests(ctx);
        return 'requests' in result ? result : { requests: [] };
      },
      enabled: enabled && !!ctx.org && !!outlet && !!session,
      staleTime: 15_000,
      refetchInterval: enabled ? 15_000 : false,
      refetchIntervalInBackground: false,
      retry: false,
    });
  }
  async reviewGuestRequest(
    outlet: string,
    session: string,
    requestId: string,
    operation: 'approve' | 'reject',
    reason?: string,
  ) {
    const ctx = { ...this.activityContext(outlet), session };
    const result = await this.api.guestRequests(ctx, { requestId, operation, reason });
    await Promise.all([
      this.client.invalidateQueries({
        queryKey: [
          'restaurants',
          ctx.org,
          'guest-requests',
          ctx.user,
          ctx.revision,
          outlet,
          session,
        ],
        exact: true,
      }),
      ...('state' in result && result.state === 'ACCEPTED'
        ? [
            this.client.invalidateQueries({
              queryKey: restaurantKeys.session(ctx.org, outlet, session),
            }),
            this.client.invalidateQueries({ queryKey: restaurantKeys.floor(ctx.org, outlet) }),
            this.client.invalidateQueries({
              queryKey: ['restaurants', ctx.org, 'service-order', ctx.user, outlet, session],
            }),
          ]
        : []),
    ]);
    return result;
  }
  guestActivity(outlet: string, enabled: boolean) {
    const ctx = {
      org: this.scope(),
      user: this.userScope(),
      revision: this.auth.contextRevision?.() ?? 0,
      outlet,
    };
    return infiniteQueryOptions({
      queryKey: ['restaurants', ctx.org, 'guest-activity', ctx.user, ctx.revision, outlet] as const,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => this.api.guestActivity(ctx, pageParam),
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!ctx.org && !!outlet,
      staleTime: 15_000,
      refetchInterval: enabled ? 15_000 : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: false,
    });
  }
  activityContext(outlet: string) {
    return {
      org: this.scope(),
      user: this.userScope(),
      revision: this.auth.contextRevision?.() ?? 0,
      outlet,
    };
  }
  activityChanged(ctx: { org: string; user: string; revision: number; outlet: string }) {
    return this.client.invalidateQueries({
      queryKey: ['restaurants', ctx.org, 'guest-activity', ctx.user, ctx.revision, ctx.outlet],
      exact: true,
    });
  }
  myOutlets(enabled = true, revision?: number, contextToken?: string) {
    const org = this.scope(),
      user = this.userScope(),
      capturedRevision = this.auth.contextRevision?.() ?? 0;
    return infiniteQueryOptions({
      queryKey:
        revision === undefined
          ? restaurantKeys.myOutlets(org, user)
          : [
              ...restaurantKeys.myOutlets(org, user),
              revision,
              ...(contextToken ? [contextToken] : []),
            ],
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) => {
        const page = await this.api.myOutlets(org, user, pageParam);
        if (
          org !== this.scope() ||
          user !== this.userScope() ||
          capturedRevision !== (this.auth.contextRevision?.() ?? 0)
        )
          throw new Error('Stale outlet context');
        return { ...page, ...(contextToken ? { contextKey: contextToken } : {}) };
      },
      getNextPageParam: (last) => last.nextCursor,
      enabled: enabled && !!org && !!user,
      staleTime: 60_000,
      refetchOnMount: true,
      retry: false,
    });
  }
  async refreshMyOutlets(org: string, user: string) {
    await this.client.resetQueries({ queryKey: restaurantKeys.myOutlets(org, user) });
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
      queryKey: restaurantKeys.session(org, outletId, sessionId, this.userScope()),
      queryFn: () => this.api.guestSession(org, outletId, sessionId),
      enabled: enabled && !!org && !!outletId && !!sessionId,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
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
    if (['menu', 'category', 'item'].includes(kind) && ctx.outletId)
      await this.client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'restaurants' &&
          query.queryKey[1] === org &&
          ['operational-carte', 'operational-menu'].includes(String(query.queryKey[2])) &&
          query.queryKey[5] === ctx.outletId,
      });
    if (kind === 'table' || kind === 'area' || kind === 'outlet')
      await this.client.invalidateQueries({
        queryKey: ctx.outletId
          ? restaurantKeys.floor(org, ctx.outletId)
          : ['restaurants', org, 'service-floor'],
      });
  }
  async refreshCarte(org: string, outlet: string) {
    await this.client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'restaurants' &&
        query.queryKey[1] === org &&
        ['operational-carte', 'operational-menu'].includes(String(query.queryKey[2])) &&
        query.queryKey[5] === outlet,
    });
  }
  async denied(org: string) {
    await this.client.invalidateQueries({ queryKey: ['product-access', org] });
  }
}
