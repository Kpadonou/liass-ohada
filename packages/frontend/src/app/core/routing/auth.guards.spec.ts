import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { CabinetDossiersApi } from '../../domains/identity/data-access/cabinet-dossiers.api';
import { WorkspacesApi } from '../../domains/identity/data-access/workspaces.api';
import { authGuard, cabinetDashboardGuard, loginRedirectGuard, tenantGuard } from './auth.guards';
import { AuthStore } from '../../domains/identity/data-access/auth.store';

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn()
}));

describe('auth guards', () => {
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };
  let cabinetDossiersApi: { listDossiers: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    TestBed.resetTestingModule();
    workspacesApi = { listWorkspaces: vi.fn().mockResolvedValue([]) };
    cabinetDossiersApi = { listDossiers: vi.fn().mockResolvedValue([]) };
    localStorage.clear();
    vi.mocked(getCurrentUser).mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: WorkspacesApi, useValue: workspacesApi },
        { provide: CabinetDossiersApi, useValue: cabinetDossiersApi }
      ]
    });
  });

  it('redirects unauthenticated users to login', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Not authenticated'));
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('redirects authenticated users with no workspaces to onboarding', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/onboarding');
  });

  it('auto-selects a single discovered workspace before dashboard access', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockResolvedValue([{ orgId: 'org-test' }]);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
    expect(TestBed.inject(AuthStore).activeOrgId()).toBe('org-test');
  });

  it('redirects signed-in users with multiple workspaces to workspace selection', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockResolvedValue([
      { orgId: 'org-a' },
      { orgId: 'org-b' }
    ]);
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/select-workspace');
  });

  it('redirects signed-in accounting-firm users away from login to the cabinet dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-firm',
        accessSource: 'DIRECT',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      {
        orgId: 'org-client',
        accessSource: 'CABINET',
        cabinetId: 'cab-123',
        displayName: 'Client SARL',
        workspaceType: 'COMPANY'
      }
    ]);
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/cabinet/dashboard');
  });

  it('does not redirect to workspace selection while discovery is pending', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    let resolveWorkspaces: (workspaces: { orgId: string }[]) => void = () => undefined;
    workspacesApi.listWorkspaces.mockReturnValue(
      new Promise((resolve) => {
        resolveWorkspaces = resolve;
      })
    );
    const router = TestBed.inject(Router);
    const createUrlTreeSpy = vi.spyOn(router, 'createUrlTree');

    const resultPromise = TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );
    await Promise.resolve();

    expect(createUrlTreeSpy).not.toHaveBeenCalledWith(['/select-workspace']);

    resolveWorkspaces([]);
    const result = await resultPromise;

    expect(router.serializeUrl(result as UrlTree)).toBe('/onboarding');
  });

  it('allows authenticated users with a tenant into the dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setTenant('org-test');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-test',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      }
    ]);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
  });

  it('redirects accounting-firm dashboard access without an active dossier to cabinet dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/cabinet/dashboard');
  });

  it('allows accounting-firm dashboard access after a dossier is selected', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    const authStore = TestBed.inject(AuthStore);
    authStore.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );
    authStore.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client'
    );

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
  });

  it('allows only accounting-firm workspaces into the cabinet dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-firm'
    );

    const result = await TestBed.runInInjectionContext(() =>
      cabinetDashboardGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
  });

  it('redirects company workspaces away from the cabinet dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setCreatedWorkspace(
      {
        orgId: 'org-company',
        displayName: 'Company Demo',
        workspaceType: 'COMPANY'
      },
      'org-company'
    );
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      cabinetDashboardGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('loads workspaces for authenticated dashboard access when only active tenant is persisted', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    localStorage.setItem('liass-ohada.activeOrgId', 'org-test');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-test',
        displayName: 'Reloaded Workspace SARL',
        workspaceType: 'COMPANY'
      }
    ]);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );
    const authStore = TestBed.inject(AuthStore);

    expect(result).toBe(true);
    expect(workspacesApi.listWorkspaces).toHaveBeenCalled();
    expect(authStore.activeWorkspaceDisplayName()).toBe('Reloaded Workspace SARL');
  });

  it('redirects signed-in users away from login', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setTenant('org-test');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-test',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY'
      }
    ]);
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });
});
