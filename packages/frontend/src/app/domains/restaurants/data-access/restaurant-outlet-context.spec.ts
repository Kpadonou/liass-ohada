import { Component, DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from './restaurant-access-state';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { RestaurantsApi } from './restaurants.api';
import { rid, row } from './restaurants.test-fixture';

@Component({ template: '' })
class OperationalHost {
  readonly context = inject(RestaurantOutletContext);
  constructor() {
    this.context.use(inject(DestroyRef), inject(ActivatedRoute), () => true);
  }
}
const org = signal('org'),
  user = signal('staff'),
  revision = signal(0),
  role = signal('WAITER');
const availability = signal<'AVAILABLE' | 'UNKNOWN' | 'UNAVAILABLE'>('AVAILABLE');
const refreshing = signal(false);
const api = { myOutlets: vi.fn(), list: vi.fn() };
let client: QueryClient, params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
beforeEach(() => {
  localStorage.clear();
  org.set('org');
  user.set('staff');
  revision.set(0);
  role.set('WAITER');
  availability.set('AVAILABLE');
  refreshing.set(false);
  api.myOutlets.mockReset().mockResolvedValue({ items: [{ outletId: rid(2), name: 'Jardin' }] });
  api.list.mockReset().mockResolvedValue({ items: [row('outlet')] });
  params = new BehaviorSubject(convertToParamMap({}));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  TestBed.configureTestingModule({
    imports: [OperationalHost],
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: client },
      { provide: RestaurantsApi, useValue: api },
      { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
      { provide: RestaurantAccessState, useValue: { refreshing } },
      { provide: ProductAccessState, useValue: { availability } },
      {
        provide: AuthStore,
        useValue: {
          effectiveOrgId: org,
          currentUserId: user,
          contextRevision: revision,
          activeWorkspaceType: () => 'COMPANY',
          activeWorkspace: () => ({ orgId: org(), productRoles: { RESTAURANTS: role() } }),
        },
      },
    ],
  });
});
afterEach(() => {
  TestBed.resetTestingModule();
  client.clear();
});
async function open() {
  const f = TestBed.createComponent(OperationalHost);
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.context.source().isSuccess()).toBe(true);
  });
  return f;
}
it.each(['OWNER', 'MANAGER', 'WAITER', 'KITCHEN', 'CASHIER'])(
  'resolves the only active outlet for %s without Staff requirements on management',
  async (value) => {
    role.set(value);
    const f = await open();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.context.id()).toBe(rid(2));
    });
    expect(f.componentInstance.context.multiple()).toBe(false);
    expect(api.myOutlets).toHaveBeenCalledTimes(['OWNER', 'MANAGER'].includes(value) ? 0 : 1);
    expect(api.list).toHaveBeenCalledTimes(['OWNER', 'MANAGER'].includes(value) ? 1 : 0);
  },
);
it('chooses once across operational mounts and reuses fresh discovery without a second request', async () => {
  api.myOutlets.mockResolvedValue({
    items: [
      { outletId: rid(2), name: 'Jardin' },
      { outletId: rid(8), name: 'Centre' },
    ],
  });
  let f = await open();
  const context = f.componentInstance.context;
  expect(context.id()).toBe('');
  context.select(rid(8));
  expect(context.id()).toBe(rid(8));
  f.destroy();
  f = await open();
  expect(f.componentInstance.context).toBe(context);
  expect(context.id()).toBe(rid(8));
  f.destroy();
  f = await open();
  expect(context.id()).toBe(rid(8));
  expect(api.myOutlets).toHaveBeenCalledTimes(1);
});
it('keeps zero and incomplete singleton discovery truthful', async () => {
  api.myOutlets
    .mockResolvedValueOnce({ items: [], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [{ outletId: rid(2), name: 'Jardin' }] });
  const f = await open(),
    context = f.componentInstance.context;
  expect(context.id()).toBe('');
  expect(context.multiple()).toBe(true);
  await context.source().fetchNextPage();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe(rid(2));
  });
});
it('retains a valid choice when one assignment grows to several and automatically adopts the sole remaining assignment', async () => {
  const f = await open(),
    context = f.componentInstance.context;
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe(rid(2));
  });
  api.myOutlets.mockResolvedValue({
    items: [
      { outletId: rid(2), name: 'Jardin' },
      { outletId: rid(8), name: 'Centre' },
    ],
  });
  await context.source().refetch();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe(rid(2));
    expect(context.multiple()).toBe(true);
  });
  api.myOutlets.mockResolvedValue({ items: [{ outletId: rid(8), name: 'Centre' }] });
  await context.source().refetch();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe(rid(8));
  });
  expect(context.multiple()).toBe(false);
  api.myOutlets.mockResolvedValue({ items: [] });
  await context.source().refetch();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe('');
  });
});
it.each(['organization', 'principal', 'revision', 'role', 'access'])(
  'immediately hides the previous choice on %s change and rejects late results',
  async (kind) => {
    const f = await open(),
      context = f.componentInstance.context;
    await vi.waitFor(() => {
      f.detectChanges();
      expect(context.id()).toBe(rid(2));
    });
    let release!: () => void;
    api.myOutlets.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ items: [{ outletId: rid(8), name: 'New' }] });
        }),
    );
    if (kind === 'organization') org.set('other');
    if (kind === 'principal') user.set('other');
    if (kind === 'revision') revision.set(1);
    if (kind === 'role') role.set('KITCHEN');
    if (kind === 'access') availability.set('UNAVAILABLE');
    expect(context.id()).toBe('');
    f.detectChanges();
    if (kind !== 'access') {
      await vi.waitFor(() => {
        f.detectChanges();
        expect(release).toBeDefined();
      });
      revision.update((value) => value + 1);
      f.detectChanges();
      release();
      expect(context.id()).toBe('');
    }
  },
);
it('hides revoked context before reconciliation finishes', async () => {
  const f = await open(),
    context = f.componentInstance.context;
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe(rid(2));
  });
  let release!: () => void;
  api.myOutlets.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ items: [] });
      }),
  );
  const pending = context.revoke(rid(2));
  expect(context.id()).toBe('');
  release();
  await pending;
  f.detectChanges();
  expect(context.id()).toBe('');
  expect(context.outlets()).toEqual([]);
});
it('accepts only discovered deep-link identifiers and never authorizes a foreign hint', async () => {
  params.next(convertToParamMap({ outlet: rid(99) }));
  const f = await open(),
    context = f.componentInstance.context;
  await vi.waitFor(() => {
    f.detectChanges();
    expect(context.id()).toBe(rid(2));
  });
  expect(context.invalidHint()).toBe(true);
  context.select(rid(99));
  expect(context.id()).toBe(rid(2));
  context.select(rid(2));
  expect(context.invalidHint()).toBe(false);
});
