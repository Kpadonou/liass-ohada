import { TestBed } from '@angular/core/testing';
import { confirmSignIn, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { vi } from 'vitest';

import { WorkspacesApi } from './workspaces.api';
import { AuthStore } from './auth.store';

vi.mock('aws-amplify/auth', () => ({
  confirmSignIn: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn()
}));

describe('AuthStore', () => {
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    TestBed.resetTestingModule();
    workspacesApi = { listWorkspaces: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: WorkspacesApi, useValue: workspacesApi }]
    });
    localStorage.clear();
    vi.mocked(confirmSignIn).mockReset();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(signIn).mockReset();
    vi.mocked(signOut).mockReset();
  });

  it('stores the current Cognito user after successful sign-in', async () => {
    const user = {
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    };
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' }
    });
    vi.mocked(getCurrentUser).mockResolvedValue(user);

    const store = TestBed.inject(AuthStore);
    await store.login('user@example.com', 'password');

    expect(store.user()).toEqual(user);
    expect(store.isAuthenticated()).toBe(true);
  });

  it('prompts for a new password when Cognito requires it', async () => {
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' }
    });

    const store = TestBed.inject(AuthStore);
    await store.login('user@example.com', 'temporary-password');

    expect(store.requiresNewPassword()).toBe(true);
    expect(store.isAuthenticated()).toBe(false);
  });

  it('stores the current Cognito user after confirming a new password', async () => {
    const user = {
      username: 'user@example.com',
      userId: 'user-123',
      signInDetails: undefined
    };
    vi.mocked(confirmSignIn).mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' }
    });
    vi.mocked(getCurrentUser).mockResolvedValue(user);

    const store = TestBed.inject(AuthStore);
    await store.confirmNewPassword('New-password-123!');

    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'New-password-123!' });
    expect(store.user()).toEqual(user);
    expect(store.requiresNewPassword()).toBe(false);
  });

  it('auto-selects the only discovered workspace', async () => {
    workspacesApi.listWorkspaces.mockResolvedValue([
      { orgId: 'org-test', role: 'ACCOUNTANT' }
    ]);
    const store = TestBed.inject(AuthStore);

    const workspaces = await store.loadWorkspaces(true);

    expect(workspaces).toEqual([{ orgId: 'org-test', role: 'ACCOUNTANT' }]);
    expect(store.activeOrgId()).toBe('org-test');
    expect(store.workspaceDestination()).toBe('/dashboard');
  });

  it('keeps multiple discovered workspaces for selection', async () => {
    workspacesApi.listWorkspaces.mockResolvedValue([
      { orgId: 'org-a', role: 'ACCOUNTANT' },
      { orgId: 'org-b', role: 'MANAGER' }
    ]);
    const store = TestBed.inject(AuthStore);

    await store.loadWorkspaces(true);

    expect(store.workspaces().map((workspace) => workspace.orgId)).toEqual([
      'org-a',
      'org-b'
    ]);
    expect(store.activeOrgId()).toBeNull();
    expect(store.workspaceDestination()).toBe('/select-workspace');
  });

  it('sets a workspace error when no workspace is assigned', async () => {
    workspacesApi.listWorkspaces.mockResolvedValue([]);
    const store = TestBed.inject(AuthStore);

    await store.loadWorkspaces(true);

    expect(store.workspaceError()).toBe('No workspace assigned.');
    expect(store.activeOrgId()).toBeNull();
  });

  it('persists the selected active tenant', () => {
    const store = TestBed.inject(AuthStore);

    store.setTenant('  org-test  ');

    expect(store.activeOrgId()).toBe('org-test');
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBe('org-test');
  });

  it('clears user and tenant state on logout', async () => {
    vi.mocked(signOut).mockResolvedValue(undefined);
    const store = TestBed.inject(AuthStore);
    store.setTenant('org-test');

    await store.logout();

    expect(store.user()).toBeNull();
    expect(store.activeOrgId()).toBeNull();
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBeNull();
  });
});
