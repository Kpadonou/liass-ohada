import { RestaurantIdSchema } from '@liass-ohada/shared/restaurants';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectInfiniteQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from './restaurant-access-state';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { RestaurantsQueries } from './restaurants.queries';
import { RestaurantsApi } from './restaurants.api';

/** Product UI context only. Canonical outlets remain in Query; selection never grants access. */
@Injectable({ providedIn: 'root' })
export class RestaurantOutletContext {
  private readonly auth = inject(AuthStore);
  private readonly access = inject(ProductAccessState);
  private readonly state = inject(RestaurantAccessState);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly queries = inject(RestaurantsQueries);
  private readonly api = inject(RestaurantsApi);
  private readonly client = inject(QueryClient);
  private readonly consumers = signal(0);
  private readonly routeActive = signal(false);
  private readonly accessEpoch = signal(0);
  private readonly selection = signal<{
    identity: string;
    id: string;
    origin?: 'preference';
  } | null>(null);
  private readonly blocked = signal<{ identity: string; ids: ReadonlySet<string> } | null>(null);
  readonly sessionInvalid = signal(false);
  private readonly preferenceKey = computed(() => {
    const user = this.queries.userScope(),
      org = this.queries.scope();
    const workspace = this.auth.activeWorkspace?.()?.orgId ?? org;
    return user && org
      ? 'liass-ohada.session.restaurants.activeOutletId.' +
          encodeURIComponent(
            JSON.stringify([user, workspace, org, this.auth.authenticatedSessionId?.() ?? null]),
          )
      : null;
  });
  private storedId(): string | null {
    try {
      const key = this.preferenceKey();
      if (!key || typeof sessionStorage === 'undefined') return null;
      const value = sessionStorage.getItem(key);
      if (!value) return null;
      const invalid = value.startsWith('invalid:');
      const parsed = RestaurantIdSchema.safeParse(invalid ? value.slice(8) : value);
      if (invalid && parsed.success) this.sessionInvalid.set(true);
      if (parsed.success) return parsed.data;
      sessionStorage.removeItem(key);
    } catch {
      /* Unavailable browser storage must not block authorized runtime use. */
    }
    return null;
  }
  private persist(id: string | null) {
    try {
      const key = this.preferenceKey();
      if (!key || typeof sessionStorage === 'undefined') return;
      if (id) sessionStorage.setItem(key, this.sessionInvalid() ? 'invalid:' + id : id);
      else sessionStorage.removeItem(key);
    } catch {
      /* Preference is best-effort; it never grants access. */
    }
  }
  readonly restoringPreference = computed(
    () =>
      this.selection()?.identity === this.identity() && !this.id() && this.source().hasNextPage(),
  );
  readonly attached = computed(() => this.routeActive() || this.consumers() > 0);
  readonly management = computed(() => this.caps.canManageSetup());
  readonly revision = computed(() => this.auth.contextRevision?.() ?? 0);
  readonly identity = computed(() =>
    JSON.stringify([
      this.queries.scope(),
      this.queries.userScope(),
      this.auth.activeWorkspace?.()?.orgId ?? this.queries.scope(),
      this.revision(),
      this.auth.activeWorkspace?.()?.productRoles?.RESTAURANTS ?? '',
      this.management(),
      this.accessEpoch(),
      this.auth.authenticatedSessionId?.() ?? null,
    ]),
  );
  readonly available = computed(
    () =>
      this.attached() &&
      !!this.queries.scope() &&
      !!this.queries.userScope() &&
      (this.management() ||
        this.caps.canReadService?.() ||
        this.caps.canReadKitchen?.() ||
        this.caps.canReadCheckout?.()) &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      !this.state.refreshing?.(),
  );
  readonly selfQuery = injectInfiniteQuery(() =>
    this.queries.myOutlets(
      this.available() && !this.management(),
      this.revision(),
      this.identity(),
    ),
  );
  readonly managementQuery = injectInfiniteQuery(() => {
    const identity = this.identity(),
      org = this.queries.scope();
    return {
      enabled: this.available() && this.management() && !!org,
      staleTime: 60_000,
      retry: false,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: { nextCursor?: string }) => last.nextCursor,
      queryKey: ['restaurants', org, 'operational-outlets', identity] as const,
      queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
        const page = await this.api.list(org, 'outlet', {}, pageParam);
        if (pageParam && page.nextCursor === pageParam) throw new Error('Repeated Outlet cursor');
        if (this.identity() !== identity) throw new Error('Stale outlet context');
        return { ...page, contextKey: identity };
      },
    };
  });
  readonly source = computed(() => ({
    isPending: () =>
      this.management() ? this.managementQuery.isPending() : this.selfQuery.isPending(),
    isSuccess: () =>
      this.management() ? this.managementQuery.isSuccess() : this.selfQuery.isSuccess(),
    isError: () => (this.management() ? this.managementQuery.isError() : this.selfQuery.isError()),
    isFetching: () =>
      this.management() ? this.managementQuery.isFetching() : this.selfQuery.isFetching(),
    error: () => (this.management() ? this.managementQuery.error() : this.selfQuery.error()),
    hasNextPage: () =>
      this.management() ? this.managementQuery.hasNextPage() : this.selfQuery.hasNextPage(),
    isFetchingNextPage: () =>
      this.management()
        ? this.managementQuery.isFetchingNextPage()
        : this.selfQuery.isFetchingNextPage(),
    fetchNextPage: () =>
      this.management() ? this.managementQuery.fetchNextPage() : this.selfQuery.fetchNextPage(),
    refetch: () => (this.management() ? this.managementQuery.refetch() : this.selfQuery.refetch()),
  }));
  readonly outlets = computed(() => {
    const query = this.source();
    const error = query.error();
    if (
      !this.available() ||
      (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
    )
      return [];
    const blocked =
      this.blocked()?.identity === this.identity() ? this.blocked()!.ids : new Set<string>();
    const rows = this.management()
      ? (this.managementQuery
          .data()
          ?.pages.filter((page) => page.contextKey === this.identity())
          .flatMap((page) => page.items) ?? [])
      : (this.selfQuery
          .data()
          ?.pages.filter((page) => page.contextKey === this.identity())
          .flatMap((page) => page.items)
          .map((row) => ({ id: row.outletId, name: row.name, isActive: true })) ?? []);
    return [
      ...new Map(
        rows.filter((row) => row.isActive && !blocked.has(row.id)).map((row) => [row.id, row]),
      ).values(),
    ];
  });
  readonly id = computed(() => {
    const selected = this.selection();
    return !this.sessionInvalid() &&
      selected?.identity === this.identity() &&
      this.outlets().some((row) => row.id === selected.id)
      ? selected.id
      : '';
  });
  readonly locked = computed(() => this.selection()?.identity === this.identity());
  readonly outlet = computed(() => this.outlets().find((row) => row.id === this.id()));
  readonly multiple = computed(() => this.outlets().length > 1 || this.source().hasNextPage());
  readonly invalidHint = signal(false);
  constructor() {
    let availability = this.access.availability('RESTAURANTS');
    let refreshing = this.state.refreshing?.() ?? false;
    effect(() => {
      const next = this.access.availability('RESTAURANTS'),
        refresh = this.state.refreshing?.() ?? false;
      if ((availability === 'AVAILABLE' && next !== 'AVAILABLE') || (!refreshing && refresh)) {
        this.accessEpoch.update((value) => value + 1);
        this.selection.set(null);
      }
      availability = next;
      refreshing = refresh;
    });
    let identity = this.identity();
    effect(() => {
      const next = this.identity();
      if (next !== identity) {
        identity = next;
        this.selection.set(null);
        this.blocked.set(null);
        this.invalidHint.set(false);
        this.sessionInvalid.set(false);
      }
    });
    let restoredIdentity = '';
    effect(() => {
      const identity = this.identity();
      if (identity === restoredIdentity) return;
      restoredIdentity = identity;
      // An existing runtime session identity takes precedence over storage restoration.
      if (this.selection()?.identity === identity) return;
      const id = this.storedId();
      if (id) this.selection.set({ identity, id, origin: 'preference' });
    });
    effect(() => {
      const id = this.id();
      if (id) this.persist(id);
    });
    effect(() => {
      const source = this.source();
      if (
        this.restoringPreference() &&
        this.available() &&
        source.isSuccess() &&
        !source.isFetching()
      )
        void source.fetchNextPage();
    });
    effect(() => {
      const error = this.source().error();
      const selected = this.selection();
      if (
        selected?.identity === this.identity() &&
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      ) {
        this.sessionInvalid.set(true);
        this.persist(selected.id);
      }
    });
    effect(() => {
      const rows = this.outlets(),
        identity = this.identity(),
        selected = this.selection();
      if (!this.available() || !this.source().isSuccess() || this.source().isFetching()) return;
      const valid = selected?.identity === identity && rows.some((row) => row.id === selected.id);
      if (!this.source().hasNextPage() && !valid) {
        if (selected?.identity === identity && selected.id) {
          this.sessionInvalid.set(true);
          this.persist(selected.id);
          return;
        }
        if (!this.sessionInvalid())
          this.selection.set(rows.length === 1 ? { identity, id: rows[0].id } : null);
      }
    });
  }
  use(destroy: DestroyRef, route: ActivatedRoute, allowed: () => boolean) {
    const handle = effect((onCleanup) => {
      if (!allowed()) return;
      this.consumers.update((count) => count + 1);
      onCleanup(() => this.consumers.update((count) => count - 1));
    });
    destroy.onDestroy(() => handle.destroy());
  }

  /** Route orchestration keeps discovery attached across operational page mounts. */
  setRouteActive(active: boolean) {
    this.routeActive.set(active);
  }
  /** URL values never select the session context. */
  hint(id: string) {
    // URL context never selects or replaces the session Outlet.
    if (this.id() && id !== this.id()) this.invalidHint.set(true);
  }
  select(id: string | null) {
    if (
      this.sessionInvalid() ||
      !id ||
      (this.selection()?.identity === this.identity() && this.selection()?.id !== id) ||
      (this.storedId() && this.storedId() !== id)
    )
      return;
    if (!this.outlets().some((row) => row.id === id)) return;
    this.invalidHint.set(false);
    this.selection.set({ identity: this.identity(), id });
    this.persist(id);
  }

  restorePreference() {
    this.invalidHint.set(false);
    if (this.id()) return;
    const id = this.storedId();
    if (id) this.selection.set({ identity: this.identity(), id, origin: 'preference' });
  }
  revalidateIfStale() {
    const source = this.source();
    const key = this.management()
      ? ['restaurants', this.queries.scope(), 'operational-outlets', this.identity()]
      : this.queries.myOutlets(true, this.revision(), this.identity()).queryKey;
    const query = this.client.getQueryCache().find({ queryKey: key, exact: true });
    if (
      query?.state.error instanceof HttpErrorResponse &&
      [401, 403].includes(query.state.error.status)
    )
      return;
    const observed = this.management() ? this.managementQuery.data() : this.selfQuery.data();
    if (
      this.available() &&
      observed?.pages[0]?.contextKey === this.identity() &&
      query?.isStaleByTime(60_000) &&
      !source.isFetching()
    )
      void source.refetch();
  }
  isRevoked(id: string) {
    return this.blocked()?.identity === this.identity() && this.blocked()!.ids.has(id);
  }
  async revoke(id: string) {
    const identity = this.identity();
    const ids = this.blocked()?.identity === identity ? this.blocked()!.ids : new Set<string>();
    this.blocked.set({ identity, ids: new Set([...ids, id]) });
    if (this.selection()?.id === id || this.storedId() === id) {
      this.sessionInvalid.set(true);
      this.persist(id);
    }
    await this.source().refetch();
  }
}
