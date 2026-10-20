import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QueryClient, queryOptions } from '@tanstack/angular-query-experimental';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { ProductAccessQueries } from '../../../core/product-access/product-access.queries';
import type { ProductAvailability } from '../../../core/product-access/product-availability';
import {
  RestaurantAccessState,
  restaurantMemberMode,
  resolveRestaurantAccess,
} from './restaurant-access-state';
import { restaurantKeys } from './restaurants.queries';
import { accessWorkspace } from './restaurant-access.test-fixture';

describe('Explicit Restaurants access lifecycle', () => {
  const workspace = signal<WorkspaceSummary>(accessWorkspace());
  const org = signal('org-a'),
    user = signal('fixture-user'),
    revision = signal(0);
  const availability = signal<ProductAvailability>('AVAILABLE');
  const workspaceError = signal<string | null>(null);
  let client: QueryClient;
  const loadWorkspaces = vi.fn(),
    listAccess = vi.fn();
  beforeEach(() => {
    workspace.set(accessWorkspace());
    org.set('org-a');
    user.set('fixture-user');
    revision.set(0);
    availability.set('AVAILABLE');
    workspaceError.set(null);
    loadWorkspaces.mockReset().mockResolvedValue([]);
    listAccess.mockReset().mockResolvedValue([]);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace: workspace,
            effectiveOrgId: org,
            currentUserId: user,
            contextRevision: revision,
            workspaceError,
            workspacesLoaded: () => true,
            loadWorkspaces,
          },
        },
        { provide: ProductAccessState, useValue: { availability } },
        {
          provide: ProductAccessQueries,
          useValue: {
            list: () => queryOptions({ queryKey: ['product-access', org()], queryFn: listAccess }),
          },
        },
        { provide: QueryClient, useValue: client },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it.each([
    ['OWNER', 'management'],
    ['MANAGER', 'management'],
    ['WAITER', 'service'],
    ['CASHIER', 'checkout'],
    ['KITCHEN', 'kitchen'],
    [undefined, 'configure'],
  ] as const)('resolves canonical role %s as %s', (role, expected) => {
    workspace.set(accessWorkspace(role));
    expect(TestBed.inject(RestaurantAccessState).mode()).toBe(expected);
  });
  it('does not infer configuration from missing entitlement, unavailable discovery or foreign membership', () => {
    expect(resolveRestaurantAccess('configure', 'UNAVAILABLE', false)).toBe('changed');
    expect(restaurantMemberMode(accessWorkspace('WAITER'), 'org-b')).toBe('changed');
    workspaceError.set('unavailable');
    expect(TestBed.inject(RestaurantAccessState).mode()).toBe('unverified');
  });
  it('distinguishes first configuration from a role that was actually removed', () => {
    const state = TestBed.inject(RestaurantAccessState);
    expect(state.mode()).toBe('configure');
    workspace.set(accessWorkspace('WAITER'));
    TestBed.tick();
    expect(state.mode()).toBe('service');
    workspace.set(accessWorkspace());
    TestBed.tick();
    expect(state.mode()).toBe('changed');
  });
  it('does not reuse organization A history or role in B and restores A safely', () => {
    workspace.set(accessWorkspace('WAITER'));
    const state = TestBed.inject(RestaurantAccessState);
    TestBed.tick();
    org.set('org-b');
    workspace.set(accessWorkspace(undefined, 'org-b'));
    TestBed.tick();
    expect(state.mode()).toBe('configure');
    org.set('org-a');
    workspace.set(accessWorkspace('WAITER'));
    TestBed.tick();
    expect(state.mode()).toBe('service');
  });
  it('refreshes membership, entitlement and only this users self-context without logout', async () => {
    const state = TestBed.inject(RestaurantAccessState),
      reset = vi.spyOn(client, 'resetQueries');
    client.setQueryData(restaurantKeys.myOutlets('org-a', 'fixture-user'), {
      pages: [{ items: [] }],
      pageParams: [undefined],
    });
    loadWorkspaces.mockImplementation(async () => workspace.set(accessWorkspace('WAITER')));
    await state.refresh();
    TestBed.tick();
    expect(loadWorkspaces).toHaveBeenCalledWith(true);
    expect(listAccess).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith({
      queryKey: restaurantKeys.myOutlets('org-a', 'fixture-user'),
    });
    expect(state.mode()).toBe('service');
    expect(state.refreshing()).toBe(false);
  });
  it('does not refresh A self-context or apply feedback to B after a switch during discovery', async () => {
    let finish!: () => void;
    loadWorkspaces.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const state = TestBed.inject(RestaurantAccessState),
      reset = vi.spyOn(client, 'resetQueries');
    const pending = state.refresh();
    org.set('org-b');
    workspace.set(accessWorkspace(undefined, 'org-b'));
    revision.set(1);
    finish();
    await pending;
    expect(listAccess).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(state.mode()).toBe('configure');
  });
  it('does not preserve another accounts previously authorized state in the same organization', () => {
    workspace.set(accessWorkspace('OWNER'));
    const state = TestBed.inject(RestaurantAccessState);
    TestBed.tick();
    user.set('second-user');
    workspace.set(accessWorkspace());
    TestBed.tick();
    expect(state.mode()).toBe('configure');
  });
});
