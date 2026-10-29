import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { getCurrentUser, fetchAuthSession, signOut } from 'aws-amplify/auth';
import { AuthStore } from '../../identity/data-access/auth.store';
import { WorkspacesApi } from '../../identity/data-access/workspaces.api';
import { CabinetDossiersApi } from '../../identity/data-access/cabinet-dossiers.api';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from './restaurant-access-state';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantOutletContext } from './restaurant-outlet-context';
import { accessWorkspace } from './restaurant-access.test-fixture';
import { rid, row } from './restaurants.test-fixture';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= Object.fromEntries(
    [
      'confirmSignIn',
      'fetchAuthSession',
      'fetchUserAttributes',
      'getCurrentUser',
      'signIn',
      'signInWithRedirect',
      'signOut',
    ].map((name) => [name, vi.fn()]),
  );
  return globalScope.__liassAmplifyAuthMock;
});

it('real logout clears runtime/session identity and a later login with multiple Outlets requires a new choice', async () => {
  sessionStorage.clear();
  localStorage.clear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = {
    list: vi.fn().mockResolvedValue({ items: [row('outlet'), { ...row('outlet'), id: rid(8) }] }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: WorkspacesApi, useValue: {} },
      { provide: CabinetDossiersApi, useValue: {} },
      { provide: RestaurantsApi, useValue: api },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      { provide: RestaurantAccessState, useValue: { refreshing: () => false } },
    ],
  });
  vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'owner', username: 'owner' });
  vi.mocked(fetchAuthSession).mockResolvedValue({
    tokens: { idToken: { payload: { auth_time: 1, email: 'owner@example.test' } } },
  } as never);
  vi.mocked(signOut).mockResolvedValue(undefined);
  const auth = TestBed.inject(AuthStore);
  const enter = async () => {
    await auth.hydrate();
    auth.setCreatedWorkspace(accessWorkspace('OWNER'), 'org-a');
  };
  try {
    await enter();
    const context = TestBed.inject(RestaurantOutletContext);
    context.setRouteActive(true);
    await vi.waitFor(() => {
      TestBed.tick();
      expect(context.outlets()).toHaveLength(2);
    });
    context.select(rid(2));
    TestBed.tick();
    expect(context.id()).toBe(rid(2));
    expect(
      Object.keys(sessionStorage).some((key) => key.startsWith('liass-ohada.session.restaurants.')),
    ).toBe(true);
    await auth.logout();
    TestBed.tick();
    expect(context.id()).toBe('');
    expect(
      Object.keys(sessionStorage).filter((key) => key.startsWith('liass-ohada.session.')),
    ).toEqual([]);
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { idToken: { payload: { auth_time: 2, email: 'owner@example.test' } } },
    } as never);
    await enter();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(context.outlets()).toHaveLength(2);
    });
    expect(context.id()).toBe('');
    expect(context.sessionInvalid()).toBe(false);
    expect(api.list).toHaveBeenCalledTimes(2);
  } finally {
    TestBed.resetTestingModule();
    client.clear();
  }
});
