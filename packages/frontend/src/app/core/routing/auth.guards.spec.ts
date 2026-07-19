import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AuthStore, type WorkspaceDestination } from '../../domains/identity/data-access/auth.store';
import {
  appRootRedirectGuard,
  authGuard,
  cabinetDashboardGuard,
  loginRedirectGuard,
  tenantGuard
} from './auth.guards';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn()
  };

  return globalScope.__liassAmplifyAuthMock;
});

type WorkspaceType = 'ACCOUNTING_FIRM' | 'COMPANY' | null;

interface FakeAuthState {
  activeDossierOrgId: string | null;
  activeTenant: boolean;
  authenticated: boolean;
  destination: WorkspaceDestination | null;
  dossiersLoaded: boolean;
  hasActiveDossier: boolean;
  hydrated: boolean;
  loadWorkspacesEffect: (() => void) | null;
  workspaceType: WorkspaceType;
  workspacesLoaded: boolean;
}

function createFakeAuthStore(state: FakeAuthState): InstanceType<typeof AuthStore> {
  return {
    activeDossierOrgId: () => state.activeDossierOrgId,
    activeWorkspaceType: () => state.workspaceType,
    dossiersLoaded: () => state.dossiersLoaded,
    enterCabinetContext: vi.fn(() => {
      state.activeDossierOrgId = null;
      state.hasActiveDossier = false;
    }),
    hasActiveDossier: () => state.hasActiveDossier,
    hasActiveTenant: () => state.activeTenant,
    hydrate: vi.fn(async () => {
      state.hydrated = true;
    }),
    hydrated: () => state.hydrated,
    isAuthenticated: () => state.authenticated,
    loadDossiers: vi.fn(async () => {
      state.dossiersLoaded = true;
      return [];
    }),
    loadWorkspaces: vi.fn(async () => {
      state.loadWorkspacesEffect?.();
      state.workspacesLoaded = true;
      return [];
    }),
    workspaceDestination: () => state.destination,
    workspacesLoaded: () => state.workspacesLoaded
  } as unknown as InstanceType<typeof AuthStore>;
}

describe('auth guards', () => {
  const accountingUrls = [
    '/accounting',
    '/accounting/accounts',
    '/accounting/chart-of-accounts',
    '/accounting/entries',
    '/accounting/entries/new',
    '/accounting/entries/entry-1',
    '/accounting/entries/entry-1/edit',
    '/accounting/fiscal-year',
    '/accounting/fiscal-years',
    '/accounting/general-ledger',
    '/accounting/auxiliary-ledger',
    '/accounting/auxiliary-balance',
    '/accounting/journal-book',
    '/accounting/journals',
    '/accounting/lettering',
    '/accounting/third-parties',
    '/accounting/trial-balance'
  ];
  let state: FakeAuthState;
  let authStore: InstanceType<typeof AuthStore>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    state = {
      activeDossierOrgId: null,
      activeTenant: false,
      authenticated: false,
      destination: '/onboarding',
      dossiersLoaded: true,
      hasActiveDossier: false,
      hydrated: true,
      loadWorkspacesEffect: null,
      workspaceType: null,
      workspacesLoaded: true
    };
    authStore = createFakeAuthStore(state);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStore }
      ]
    });
  });

  it('redirects unauthenticated users to login', async () => {
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirects unauthenticated app root access to login', async () => {
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      appRootRedirectGuard({} as never, { url: '/' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirects authenticated users with no workspaces to onboarding', async () => {
    state.authenticated = true;
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/onboarding');
  });

  it('auto-selects a single discovered company workspace before dashboard access', async () => {
    state.authenticated = true;
    state.workspacesLoaded = false;
    state.loadWorkspacesEffect = () => {
      state.activeTenant = true;
      state.destination = '/dashboard';
      state.workspaceType = 'COMPANY';
    };

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
    expect(authStore.loadWorkspaces).toHaveBeenCalled();
  });

  it('redirects signed-in users with multiple workspaces to workspace selection', async () => {
    state.authenticated = true;
    state.destination = '/select-workspace';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/select-workspace');
  });

  it('redirects signed-in accounting-firm users away from login to the cabinet dashboard', async () => {
    state.authenticated = true;
    state.destination = '/cabinet/dashboard';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/cabinet/dashboard');
  });

  it('does not redirect to workspace selection while discovery is pending', async () => {
    state.authenticated = true;
    state.destination = null;
    state.workspacesLoaded = false;
    let resolveWorkspaces: () => void = () => undefined;
    vi.mocked(authStore.loadWorkspaces).mockImplementation(
      () =>
        new Promise<[]>(resolve => {
          resolveWorkspaces = () => {
            state.destination = '/onboarding';
            resolve([]);
          };
        })
    );
    const router = TestBed.inject(Router);
    const createUrlTreeSpy = vi.spyOn(router, 'createUrlTree');

    const resultPromise = TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );
    await Promise.resolve();

    expect(createUrlTreeSpy).not.toHaveBeenCalledWith(['/select-workspace']);

    resolveWorkspaces();
    const result = await resultPromise;

    expect(router.serializeUrl(result as UrlTree)).toBe('/onboarding');
  });

  it('allows authenticated company users with a tenant into the dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/dashboard';
    state.workspaceType = 'COMPANY';

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
  });

  it('allows authenticated company users into accounting routes', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/dashboard';
    state.workspaceType = 'COMPANY';

    for (const url of accountingUrls) {
      const result = await TestBed.runInInjectionContext(() =>
        tenantGuard({} as never, { url } as never)
      );

      expect(result).toBe(true);
    }
  });

  it('redirects authenticated company users from the app root to the dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/dashboard';
    state.workspaceType = 'COMPANY';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('routes authenticated company app root access to the workspace destination', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/dashboard';
    state.workspaceType = 'COMPANY';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      appRootRedirectGuard({} as never, { url: '/' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('redirects authenticated accounting-firm users from the app root to the cabinet dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/cabinet/dashboard';
    state.workspaceType = 'ACCOUNTING_FIRM';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/cabinet/dashboard');
  });

  it('routes authenticated accounting-firm app root access to the cabinet dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/cabinet/dashboard';
    state.workspaceType = 'ACCOUNTING_FIRM';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      appRootRedirectGuard({} as never, { url: '/' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/cabinet/dashboard');
  });

  it('redirects accounting-firm dashboard access without an active dossier to cabinet dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/cabinet/dashboard';
    state.workspaceType = 'ACCOUNTING_FIRM';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/dashboard' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/cabinet/dashboard');
  });

  it('allows accounting-firm users into cabinet shell routes without an active dossier', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.workspaceType = 'ACCOUNTING_FIRM';

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/cabinet/dossiers' } as never)
    );

    expect(result).toBe(true);
  });

  it('allows accounting-firm users into new dossier creation without an active dossier', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.workspaceType = 'ACCOUNTING_FIRM';

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/cabinet/dossiers/new' } as never)
    );

    expect(result).toBe(true);
  });

  it('allows accounting-firm dashboard access after a dossier is selected', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.activeDossierOrgId = 'org-client';
    state.hasActiveDossier = true;
    state.workspaceType = 'ACCOUNTING_FIRM';

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/dashboard' } as never)
    );

    expect(result).toBe(true);
  });

  it('allows accounting-firm users with an active dossier into accounting routes', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.activeDossierOrgId = 'org-client';
    state.hasActiveDossier = true;
    state.workspaceType = 'ACCOUNTING_FIRM';

    for (const url of accountingUrls) {
      const result = await TestBed.runInInjectionContext(() =>
        tenantGuard({} as never, { url } as never)
      );

      expect(result).toBe(true);
    }
  });

  it('loads persisted dossier context before allowing accounting-firm accounting routes', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.activeDossierOrgId = 'org-client';
    state.dossiersLoaded = false;
    state.hasActiveDossier = false;
    state.workspaceType = 'ACCOUNTING_FIRM';
    vi.mocked(authStore.loadDossiers).mockImplementation(async () => {
      state.dossiersLoaded = true;
      state.hasActiveDossier = true;
      return [];
    });

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/accounting/general-ledger' } as never)
    );

    expect(result).toBe(true);
    expect(authStore.loadDossiers).toHaveBeenCalled();
  });

  it('returns invalid persisted dossier context to the dossier list with recovery state', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.activeDossierOrgId = 'org-stale-client';
    state.dossiersLoaded = false;
    state.hasActiveDossier = false;
    state.workspaceType = 'ACCOUNTING_FIRM';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/accounting/general-ledger' } as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/cabinet/dossiers?contextRecovery=1'
    );
    expect(authStore.enterCabinetContext).toHaveBeenCalled();
  });

  it('allows only accounting-firm workspaces into the cabinet dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.workspaceType = 'ACCOUNTING_FIRM';

    const result = await TestBed.runInInjectionContext(() =>
      cabinetDashboardGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
  });

  it('redirects company workspaces away from the cabinet dashboard', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/dashboard';
    state.workspaceType = 'COMPANY';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      cabinetDashboardGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('loads workspaces for authenticated dashboard access when only active tenant is persisted', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.workspacesLoaded = false;
    state.workspaceType = 'COMPANY';
    state.destination = '/dashboard';

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
    expect(authStore.loadWorkspaces).toHaveBeenCalled();
  });

  it('redirects signed-in users away from login', async () => {
    state.authenticated = true;
    state.activeTenant = true;
    state.destination = '/dashboard';
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });
});
