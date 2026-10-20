import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import {
  ProductAccessQueries,
  productAccessQueryKeys,
} from '../../../core/product-access/product-access.queries';
import type { ProductAvailability } from '../../../core/product-access/product-availability';
import { restaurantKeys } from './restaurants.queries';

export type RestaurantMemberMode =
  | 'configure'
  | 'management'
  | 'service'
  | 'kitchen'
  | 'checkout'
  | 'unsupported'
  | 'changed'
  | 'unverified';
export type RestaurantAccessMode = RestaurantMemberMode | 'checking' | 'unverified';

/** Membership discovery returns active access only. A role belongs to this exact direct tenant. */
export function restaurantMemberMode(
  workspace: WorkspaceSummary | null,
  org: string | null,
): RestaurantMemberMode {
  if (
    !org ||
    workspace?.orgId !== org ||
    workspace.workspaceType !== 'COMPANY' ||
    (workspace.accessSource && workspace.accessSource !== 'DIRECT') ||
    (workspace.status && workspace.status !== 'ACTIVE')
  )
    return 'changed';
  switch (workspace.productRoles?.RESTAURANTS) {
    case 'OWNER':
    case 'MANAGER':
      return 'management';
    case 'WAITER':
      return 'service';
    case 'KITCHEN':
      return 'kitchen';
    case 'CASHIER':
      return 'checkout';
    case undefined:
      return 'configure';
    default:
      return 'unverified';
  }
}

export function resolveRestaurantAccess(
  mode: RestaurantMemberMode,
  availability: ProductAvailability,
  previouslyAuthorized: boolean,
): RestaurantAccessMode {
  if (availability === 'UNKNOWN') return 'checking';
  if (availability === 'UNAVAILABLE') return 'changed';
  return mode === 'configure' && previouslyAuthorized ? 'changed' : mode;
}

@Injectable({ providedIn: 'root' })
export class RestaurantAccessState {
  private readonly auth = inject(AuthStore);
  private readonly access = inject(ProductAccessState);
  private readonly accessQueries = inject(ProductAccessQueries);
  private readonly client = inject(QueryClient);
  private readonly seen = signal<ReadonlySet<string>>(new Set());
  private readonly refreshScope = signal<{ identity: string; revision: number } | null>(null);
  private readonly failedScope = signal<string | null>(null);
  readonly refreshing = computed(
    () =>
      this.refreshScope()?.identity === this.identity() &&
      this.refreshScope()?.revision === this.auth.contextRevision(),
  );
  readonly refreshFailed = computed(() => this.failedScope() === this.identity());
  readonly role = computed(() => this.auth.activeWorkspace()?.productRoles?.RESTAURANTS);
  readonly memberMode = computed(() =>
    restaurantMemberMode(this.auth.activeWorkspace(), this.auth.effectiveOrgId()),
  );
  private readonly identity = computed(
    () => `${this.auth.currentUserId() ?? ''}:${this.auth.effectiveOrgId() ?? ''}`,
  );
  readonly mode = computed<RestaurantAccessMode>(() => {
    if (this.refreshing() || !this.auth.workspacesLoaded()) return 'checking';
    if (this.auth.workspaceError() || this.refreshFailed()) return 'unverified';
    return resolveRestaurantAccess(
      this.memberMode(),
      this.access.availability('RESTAURANTS'),
      this.seen().has(this.identity()),
    );
  });
  constructor() {
    let principal = this.auth.currentUserId();
    effect(() => {
      const user = this.auth.currentUserId();
      if (user !== principal) {
        principal = user;
        this.seen.set(new Set());
      }
      const mode = this.memberMode();
      if (
        user &&
        this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
        ['management', 'service', 'kitchen', 'checkout', 'unsupported'].includes(mode) &&
        !this.seen().has(this.identity())
      )
        this.seen.update((seen) => new Set([...seen, this.identity()]));
    });
  }
  async refresh() {
    if (this.refreshing()) return;
    const org = this.auth.effectiveOrgId(),
      user = this.auth.currentUserId(),
      revision = this.auth.contextRevision();
    const current = () =>
      this.auth.effectiveOrgId() === org &&
      this.auth.currentUserId() === user &&
      this.auth.contextRevision() === revision;
    const operation = { identity: this.identity(), revision };
    this.refreshScope.set(operation);
    this.failedScope.set(null);
    try {
      await this.auth.loadWorkspaces(true);
      if (!current() || !org || !user) return;
      await this.client.invalidateQueries({
        queryKey: productAccessQueryKeys.list(org),
        exact: true,
        refetchType: 'none',
      });
      await this.client.fetchQuery(this.accessQueries.list());
      if (!current()) return;
      await this.client.resetQueries({
        queryKey: restaurantKeys.myOutlets(org, user),
      });
    } catch {
      if (current()) this.failedScope.set(this.identity());
    } finally {
      if (this.refreshScope() === operation) this.refreshScope.set(null);
    }
  }
}
