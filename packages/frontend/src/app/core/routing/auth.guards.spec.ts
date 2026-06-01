import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { getCurrentUser } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { WorkspacesApi } from '../../domains/identity/data-access/workspaces.api';
import { authGuard, loginRedirectGuard, tenantGuard } from './auth.guards';
import { AuthStore } from '../../domains/identity/data-access/auth.store';

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn()
}));

describe('auth guards', () => {
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    TestBed.resetTestingModule();
    workspacesApi = { listWorkspaces: vi.fn().mockResolvedValue([]) };
    localStorage.clear();
    vi.mocked(getCurrentUser).mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: WorkspacesApi, useValue: workspacesApi }
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

  it('redirects authenticated users without a tenant to workspace selection', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/select-workspace');
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

  it('allows authenticated users with a tenant into the dashboard', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setTenant('org-test');

    const result = await TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, {} as never)
    );

    expect(result).toBe(true);
  });

  it('redirects signed-in users away from login', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    });
    TestBed.inject(AuthStore).setTenant('org-test');
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      loginRedirectGuard({} as never, {} as never)
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });
});
