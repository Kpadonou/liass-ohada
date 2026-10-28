import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
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
  private readonly consumers = signal(0);
  private readonly routeActive = signal(false);
  private readonly accessEpoch = signal(0);
  private readonly selection = signal<{ identity: string; id: string } | null>(null);
  private readonly blocked = signal<{ identity: string; ids: ReadonlySet<string> } | null>(null);
  readonly attached = computed(() => this.routeActive() || this.consumers() > 0);
  readonly management = computed(() => this.caps.canManageSetup());
  readonly revision = computed(() => this.auth.contextRevision?.() ?? 0);
  readonly identity = computed(() =>
    JSON.stringify([
      this.queries.scope(),
      this.queries.userScope(),
      this.revision(),
      this.auth.activeWorkspace?.()?.productRoles?.RESTAURANTS ?? '',
      this.management(),
      this.accessEpoch(),
    ]),
  );
  readonly available = computed(
    () =>
      this.attached() &&
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
    if (!this.available() || !query.isSuccess()) return [];
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
    return selected?.identity === this.identity() &&
      this.outlets().some((row) => row.id === selected.id)
      ? selected.id
      : '';
  });
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
        this.invalidHint.set(false);
      }
    });
    effect(() => {
      const rows = this.outlets(),
        identity = this.identity(),
        selected = this.selection();
      if (!this.available() || !this.source().isSuccess() || this.source().isFetching()) return;
      const valid = selected?.identity === identity && rows.some((row) => row.id === selected.id);
      if (!this.source().hasNextPage() && !valid) {
        if (selected?.identity === identity && selected.id) this.invalidHint.set(true);
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
    const subscription = route.queryParamMap.subscribe((params) => {
      const id = params.get('outlet');
      if (id) this.selection.set({ identity: this.identity(), id });
    });
    destroy.onDestroy(() => {
      subscription.unsubscribe();
      handle.destroy();
    });
  }
  /** Route orchestration keeps discovery attached across operational page mounts. */
  setRouteActive(active: boolean) {
    this.routeActive.set(active);
  }
  /** URL values are hints only; id() still requires a discovered authorized row. */
  hint(id: string) {
    this.invalidHint.set(false);
    this.selection.set({ identity: this.identity(), id });
  }
  select(id: string | null) {
    if (id && !this.outlets().some((row) => row.id === id)) return;
    this.invalidHint.set(false);
    this.selection.set(id ? { identity: this.identity(), id } : null);
  }
  async revoke(id: string) {
    const identity = this.identity();
    const ids = this.blocked()?.identity === identity ? this.blocked()!.ids : new Set<string>();
    this.blocked.set({ identity, ids: new Set([...ids, id]) });
    this.selection.set(null);
    await this.source().refetch();
  }
}
