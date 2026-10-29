import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CanActivateChildFn, NavigationEnd, PRIMARY_OUTLET, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { RestaurantAccessState } from './restaurant-access-state';
import { AuthStore } from '../../identity/data-access/auth.store';

export type OutletResolution =
  | 'loading'
  | 'ready'
  | 'selection-required'
  | 'no-accessible-context'
  | 'invalid-selection'
  | 'access-changed'
  | 'error';

/** Operational route classification; the product gate additionally covers all management routes. */
export function operationalOutletRoute(path: string): boolean {
  return (
    /^\/restaurants\/(service|kitchen|checkout|inventory)$/.test(path) ||
    /^\/restaurants\/cash(\/day)?$/.test(path) ||
    /^\/restaurants\/service\/outlets\/[^/]+\/sessions\/[^/]+$/.test(path) ||
    /^\/restaurants\/outlets\/[^/]+\/sessions\/[^/]+\/receipt$/.test(path)
  );
}

@Injectable({ providedIn: 'root' })
export class RestaurantOutletRouting {
  readonly context = inject(RestaurantOutletContext);
  readonly access = inject(RestaurantAccessState);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly principal = computed(() =>
    JSON.stringify([this.auth.effectiveOrgId(), this.auth.currentUserId()]),
  );
  private readonly currentUrl = signal(this.router.url);
  // Navigation metadata only. The existing context remains the sole selection owner.
  private readonly target = signal<{
    identity: string;
    principal: string;
    url: string;
    hint: string;
    resource: boolean;
  } | null>(null);
  readonly destination = computed(() =>
    this.target()?.identity === this.context.identity() ? this.target() : null,
  );
  readonly resourceTarget = computed(() => this.destination()?.resource ?? false);
  readonly resolution = computed<OutletResolution>(() => {
    const source = this.context.source();
    if (this.context.sessionInvalid()) return 'access-changed';
    if (this.target() && !this.destination()) return 'access-changed';
    if (!this.context.available()) {
      return this.access.mode() === 'checking' ? 'loading' : 'access-changed';
    }
    const target = this.destination();
    if (this.context.id() && target?.hint && target.hint !== this.context.id())
      return 'invalid-selection';
    if (source.isError()) {
      const error = source.error();
      return error instanceof HttpErrorResponse && [401, 403].includes(error.status)
        ? 'access-changed'
        : this.context.id()
          ? 'ready'
          : 'error';
    }
    if (!source.isSuccess() || this.context.restoringPreference()) return 'loading';
    if (target?.hint && !this.context.outlets().some((row) => row.id === target.hint)) {
      if (source.hasNextPage()) return 'selection-required';
      return 'invalid-selection';
    }
    if (this.context.id())
      return target?.hint && target.hint !== this.context.id() ? 'invalid-selection' : 'ready';
    if (source.isFetching()) return 'loading';
    if (this.context.locked()) return source.hasNextPage() ? 'loading' : 'access-changed';
    if (this.context.invalidHint()) return 'invalid-selection';
    if (this.context.outlets().length === 1 && !source.hasNextPage()) return 'loading';
    return this.context.outlets().length || source.hasNextPage()
      ? 'selection-required'
      : 'no-accessible-context';
  });
  readonly routeReady = computed(() => {
    const path = this.path(this.currentUrl());
    if (path === '/restaurants/context' || !path.startsWith('/restaurants')) return true;
    const resourceOutlet = this.resourceOutlet(path);
    return (
      !!this.context.id() &&
      this.context.available() &&
      (!resourceOutlet || resourceOutlet === this.context.id())
    );
  });
  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      this.currentUrl.set(event.urlAfterRedirects);
      const path = this.path(event.urlAfterRedirects);
      this.context.setRouteActive(path === '/restaurants' || path.startsWith('/restaurants/'));
      if (!operationalOutletRoute(path) && path !== '/restaurants/context') this.target.set(null);
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    effect(() => {
      const url = this.currentUrl();
      const navigating = this.router.currentNavigation();
      if (
        !navigating &&
        this.path(url).startsWith('/restaurants') &&
        this.path(url) !== '/restaurants/context' &&
        !this.routeReady()
      ) {
        untracked(() => {
          this.begin(url, false);
          void this.router.navigateByUrl(this.selectionUrl(this.destination()?.url ?? url), {
            replaceUrl: true,
          });
        });
      }
    });
  }
  private path(url: string) {
    return (
      this.router
        .parseUrl(url)
        .root.children[PRIMARY_OUTLET]?.segments.map((s) => '/' + s.path)
        .join('') ?? ''
    );
  }
  private resourceOutlet(path: string) {
    return /^\/restaurants\/(?:service\/)?outlets\/([^/]+)\/sessions\//.exec(path)?.[1] ?? '';
  }
  /** Restrict return destinations to known local operational routes, with no auxiliary outlets. */
  validDestination(url: string): boolean {
    if (url.split(/[?#]/)[0] !== '/restaurants' && !url.startsWith('/restaurants/')) return false;
    try {
      const tree = this.router.parseUrl(url);
      const group = tree.root.children[PRIMARY_OUTLET];
      return (
        Object.keys(tree.root.children).length === 1 &&
        !!group &&
        !Object.keys(group.children).length &&
        group.segments.every((s) => !Object.keys(s.parameters).length) &&
        (this.path(url) === '/restaurants' ||
          operationalOutletRoute(this.path(url)) ||
          /^\/restaurants\/(?:setup(?:\/(?:locations|areas|tables|stations|team))?|menu)$/.test(
            this.path(url),
          ))
      );
    } catch {
      return false;
    }
  }
  begin(url: string, applyHint = true) {
    if (!this.validDestination(url)) return false;
    this.context.setRouteActive(true);
    this.context.revalidateIfStale();
    const path = this.path(url);
    const resource = this.resourceOutlet(path);
    let hint =
      resource ||
      (operationalOutletRoute(path) ? this.router.parseUrl(url).queryParamMap.get('outlet') : '') ||
      '';
    // An explicitly revoked active filter is obsolete navigation metadata, not a new deep-link request.
    // Resource parent links and incoming untrusted hints still require exact authorization.
    if (!resource && !applyHint && hint && this.context.isRevoked(hint)) {
      const tree = this.router.parseUrl(url);
      delete tree.queryParams['outlet'];
      url = this.router.serializeUrl(tree);
      hint = '';
    }
    this.target.set({
      identity: this.context.identity(),
      principal: this.principal(),
      url,
      hint,
      resource: !!resource,
    });
    if (!hint) this.context.restorePreference();

    return true;
  }
  selectionUrl(url: string) {
    return this.router.createUrlTree(['/restaurants/context'], { queryParams: { returnUrl: url } });
  }
  canEnter(url: string) {
    if (!this.begin(url)) return false;
    if (this.resolution() !== 'ready') return false;
    this.context.select(this.context.id());
    return true;
  }
  async resume() {
    const target = this.destination();
    if (!target || this.resolution() !== 'ready') return;
    await this.router.navigateByUrl(target.url, { replaceUrl: true });
  }
  async refreshAccess() {
    const target = this.target();
    const org = this.auth.effectiveOrgId(),
      user = this.auth.currentUserId();
    await this.access.refresh();
    // Only an explicit recovery can rebind a return destination after access refresh.
    if (
      target?.principal === this.principal() &&
      org === this.auth.effectiveOrgId() &&
      user === this.auth.currentUserId()
    )
      this.begin(target.url);
  }
  choose(id: string) {
    if (this.context.sessionInvalid() || this.context.id()) return;
    const target = this.destination();
    if (!target || !this.context.outlets().some((row) => row.id === id)) return;
    // Resource links cannot silently substitute a different visit's parent Outlet.
    if (target.resource && target.hint !== id) return;
    this.context.select(id);
    const tree = this.router.parseUrl(target.url);
    tree.queryParams = { ...tree.queryParams, outlet: id };
    this.target.set({ ...target, hint: id, url: this.router.serializeUrl(tree) });
  }
}

/** Every Restaurants child is gated; only isolated entry remains available before readiness. */
export const restaurantProductBootstrapGuard: CanActivateChildFn = (route, state) => {
  if (route.routeConfig?.path === 'context') return true;
  const routing = inject(RestaurantOutletRouting);
  return routing.canEnter(state.url) ? true : routing.selectionUrl(state.url);
};
