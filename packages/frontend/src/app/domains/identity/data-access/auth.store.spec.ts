import { TestBed } from '@angular/core/testing';
import {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signInWithRedirect,
  signOut
} from 'aws-amplify/auth';
import { vi } from 'vitest';

import { WorkspacesApi } from './workspaces.api';
import { CabinetDossiersApi } from './cabinet-dossiers.api';
import { AuthStore } from './auth.store';

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

describe('AuthStore', () => {
  let workspacesApi: { listWorkspaces: ReturnType<typeof vi.fn> };
  let cabinetDossiersApi: { listDossiers: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    TestBed.resetTestingModule();
    workspacesApi = { listWorkspaces: vi.fn() };
    cabinetDossiersApi = { listDossiers: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkspacesApi, useValue: workspacesApi },
        { provide: CabinetDossiersApi, useValue: cabinetDossiersApi }
      ]
    });
    localStorage.clear();
    vi.mocked(confirmSignIn).mockReset();
    vi.mocked(fetchAuthSession).mockReset();
    vi.mocked(fetchUserAttributes).mockReset();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(signIn).mockReset();
    vi.mocked(signInWithRedirect).mockReset();
    vi.mocked(signOut).mockReset();
    vi.mocked(fetchAuthSession).mockResolvedValue({} as never);
    vi.mocked(fetchUserAttributes).mockResolvedValue({});
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
    vi.mocked(fetchUserAttributes).mockResolvedValue({
      email: 'user@example.com',
      name: 'Chrys Kpadonou'
    });

    const store = TestBed.inject(AuthStore);
    await store.login('user@example.com', 'password');

    expect(store.user()).toEqual(user);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.userDisplayName()).toBe('Chrys Kpadonou');
    expect(store.userEmail()).toBe('user@example.com');
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
    vi.mocked(fetchUserAttributes).mockResolvedValue({
      email: 'user@example.com',
      given_name: 'Chrys',
      family_name: 'Kpadonou'
    });

    const store = TestBed.inject(AuthStore);
    await store.confirmNewPassword('New-password-123!');

    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'New-password-123!' });
    expect(store.user()).toEqual(user);
    expect(store.userDisplayName()).toBe('Chrys Kpadonou');
    expect(store.requiresNewPassword()).toBe(false);
  });

  it('falls back to ID-token email instead of Cognito provider username for the user display label', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'Google_123456789',
      userId: 'user-123',
      signInDetails: undefined
    });
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            email: 'chrys.kpadonou@example.com'
          }
        }
      }
    } as never);
    const store = TestBed.inject(AuthStore);

    await store.hydrate();

    expect(fetchUserAttributes).not.toHaveBeenCalled();
    expect(store.userDisplayName()).toBe('chrys.kpadonou@example.com');
    expect(store.userDisplayName()).not.toBe('Google_123456789');
  });

  it('uses safe ID-token claims without fetching user attributes after OAuth', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'Google_123456789',
      userId: 'user-123',
      signInDetails: undefined
    });
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            email: 'remi@example.com',
            given_name: 'Remi',
            family_name: 'KPADONOU',
            picture: 'https://example.com/profile.png'
          }
        }
      }
    } as never);
    const store = TestBed.inject(AuthStore);

    await store.hydrate();

    expect(fetchUserAttributes).not.toHaveBeenCalled();
    expect(store.userDisplayName()).toBe('Remi KPADONOU');
    expect(store.userEmail()).toBe('remi@example.com');
    expect(store.userPictureUrl()).toBe('https://example.com/profile.png');
    expect(store.currentUserDisplayName()).toBe('Remi KPADONOU');
    expect(store.currentUserEmail()).toBe('remi@example.com');
    expect(store.currentUserPicture()).toBe('https://example.com/profile.png');
  });

  it('refreshes the user profile from safe ID-token claims after an already-hydrated session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'Google_123456789',
      userId: 'user-123',
      signInDetails: undefined
    });
    vi.mocked(fetchAuthSession)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({
        tokens: {
          idToken: {
            payload: {
              email: 'chrys.kpadonou@example.com',
              name: 'Chrys Kpadonou'
            }
          }
        }
      } as never);
    const store = TestBed.inject(AuthStore);

    await store.hydrate();
    expect(store.currentUserDisplayName()).toBeNull();

    await store.refreshUserProfile();

    expect(fetchUserAttributes).not.toHaveBeenCalled();
    expect(store.currentUserDisplayName()).toBe('Chrys Kpadonou');
    expect(store.currentUserEmail()).toBe('chrys.kpadonou@example.com');
  });

  it('returns null user display labels when no human-readable identity is available', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: 'Google_123456789',
      userId: 'user-123',
      signInDetails: undefined
    });
    vi.mocked(fetchUserAttributes).mockResolvedValue({});
    const store = TestBed.inject(AuthStore);

    await store.hydrate();

    expect(store.userDisplayName()).toBeNull();
    expect(store.userEmail()).toBeNull();
  });

  it('auto-selects the only discovered workspace', async () => {
    workspacesApi.listWorkspaces.mockResolvedValue([
      { orgId: 'org-test', role: 'ACCOUNTANT', workspaceType: 'COMPANY' }
    ]);
    const store = TestBed.inject(AuthStore);

    const workspaces = await store.loadWorkspaces(true);

    expect(workspaces).toEqual([{ orgId: 'org-test', role: 'ACCOUNTANT', workspaceType: 'COMPANY' }]);
    expect(store.activeOrgId()).toBe('org-test');
    expect(store.activeWorkspaceOrgId()).toBe('org-test');
    expect(store.activeWorkspace()).toEqual({
      orgId: 'org-test',
      role: 'ACCOUNTANT',
      workspaceType: 'COMPANY'
    });
    expect(store.workspaceDestination()).toBe('/dashboard');
  });

  it('routes a single direct accounting-firm workspace to the cabinet dashboard', async () => {
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-firm',
        role: 'OWNER',
        accessSource: 'DIRECT',
        displayName: 'Cabinet Demo',
        workspaceType: 'ACCOUNTING_FIRM'
      }
    ]);
    const store = TestBed.inject(AuthStore);

    await store.loadWorkspaces(true);

    expect(store.activeWorkspaceOrgId()).toBe('org-firm');
    expect(store.activeWorkspaceType()).toBe('ACCOUNTING_FIRM');
    expect(store.workspaceDestination()).toBe('/cabinet/dashboard');
  });

  it('does not treat cabinet-sourced client rows as direct selectable workspaces', async () => {
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
    const store = TestBed.inject(AuthStore);

    await store.loadWorkspaces(true);

    expect(store.workspaces().map((workspace) => workspace.orgId)).toEqual([
      'org-firm',
      'org-client'
    ]);
    expect(store.directWorkspaces().map((workspace) => workspace.orgId)).toEqual(['org-firm']);
    expect(store.activeWorkspaceOrgId()).toBe('org-firm');
    expect(store.workspaceDestination()).toBe('/cabinet/dashboard');
  });

  it('returns no workspace destination while discovery is pending', () => {
    const store = TestBed.inject(AuthStore);

    expect(store.workspaceDestination()).toBeNull();
  });

  it('keeps multiple direct discovered workspaces for fallback selection', async () => {
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

  it('routes users with no discovered workspaces to onboarding', async () => {
    workspacesApi.listWorkspaces.mockResolvedValue([]);
    const store = TestBed.inject(AuthStore);

    await store.loadWorkspaces(true);

    expect(store.workspaceError()).toBeNull();
    expect(store.activeOrgId()).toBeNull();
    expect(store.workspaceDestination()).toBe('/onboarding');
  });

  it('persists the selected active tenant', () => {
    const store = TestBed.inject(AuthStore);

    store.setTenant('  org-test  ');

    expect(store.activeOrgId()).toBe('org-test');
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBe('org-test');
  });

  it('stores a newly created workspace as the active tenant', () => {
    const store = TestBed.inject(AuthStore);

    store.setCreatedWorkspace(
      {
        orgId: 'org-created',
        role: 'OWNER',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY',
        status: 'ACTIVE',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED'
      },
      'org-created'
    );

    expect(store.activeOrgId()).toBe('org-created');
    expect(store.activeWorkspaceDisplayName()).toBe('Demo SARL');
    expect(store.activeWorkspaceType()).toBe('COMPANY');
    expect(store.activeWorkspaceKind()).toBe('COMPANY');
    expect(store.activeWorkspaceTypeLabelKey()).toBe('SHELL.WORKSPACE_TYPES.COMPANY');
    expect(store.workspacesLoaded()).toBe(true);
    expect(store.workspaces()).toEqual([
      {
        orgId: 'org-created',
        role: 'OWNER',
        displayName: 'Demo SARL',
        workspaceType: 'COMPANY',
        status: 'ACTIVE',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED'
      }
    ]);
    expect(store.workspaceDestination()).toBe('/dashboard');
  });

  it('resolves the active workspace display name after reload from the loaded workspace list', async () => {
    localStorage.setItem('liass-ohada.activeOrgId', 'org-reloaded');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-other',
        displayName: 'Other Workspace',
        workspaceType: 'COMPANY'
      },
      {
        orgId: 'org-reloaded',
        displayName: 'Reloaded SARL',
        workspaceType: 'COMPANY'
      }
    ]);
    const store = TestBed.inject(AuthStore);

    await store.hydrate();
    await store.loadWorkspaces();

    expect(store.activeOrgId()).toBe('org-reloaded');
    expect(store.activeWorkspaceDisplayName()).toBe('Reloaded SARL');
    expect(store.activeWorkspaceType()).toBe('COMPANY');
  });

  it('falls back to nested organization and cabinet names when displayName is missing', () => {
    const store = TestBed.inject(AuthStore);

    store.setCreatedWorkspace(
      {
        orgId: 'org-nested-company',
        organization: { name: 'Nested Company SARL' },
        workspaceType: 'COMPANY'
      },
      'org-nested-company'
    );
    expect(store.activeWorkspaceDisplayName()).toBe('Nested Company SARL');

    store.setCreatedWorkspace(
      {
        orgId: 'org-nested-firm',
        cabinet: { name: 'Nested Cabinet Conseil' },
        workspaceType: 'ACCOUNTING_FIRM'
      },
      'org-nested-firm'
    );
    expect(store.activeWorkspaceDisplayName()).toBe('Nested Cabinet Conseil');
    expect(store.activeWorkspaceTypeLabelKey()).toBe('SHELL.WORKSPACE_TYPES.ACCOUNTING_FIRM');
  });

  it('derives the selected accounting-firm workspace display name and type', () => {
    const store = TestBed.inject(AuthStore);

    store.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        role: 'OWNER',
        cabinetId: 'cabinet-001',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        status: 'ACTIVE',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED'
      },
      'org-firm'
    );

    expect(store.activeWorkspaceDisplayName()).toBe('Cabinet KPADONOU Conseil');
    expect(store.activeWorkspaceType()).toBe('ACCOUNTING_FIRM');
  });

  it('loads but does not auto-select the only accounting-firm client dossier', async () => {
    const store = TestBed.inject(AuthStore);
    store.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-firm'
    );
    cabinetDossiersApi.listDossiers.mockResolvedValue([
      {
        orgId: 'org-client',
        displayName: 'Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]);

    await store.loadDossiers();

    expect(store.activeDossierOrgId()).toBeNull();
    expect(store.activeDossierDisplayName()).toBeNull();
    expect(store.workspaceDestination()).toBe('/cabinet/dashboard');
    expect(localStorage.getItem('liass-ohada.activeDossierOrgId')).toBeNull();
  });

  it('routes accounting-firm workspaces with no client dossiers to the cabinet dashboard', async () => {
    const store = TestBed.inject(AuthStore);
    store.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-firm'
    );
    cabinetDossiersApi.listDossiers.mockResolvedValue([]);

    await store.loadDossiers();

    expect(store.activeDossierOrgId()).toBeNull();
    expect(store.workspaceDestination()).toBe('/cabinet/dashboard');
  });

  it('routes accounting-firm workspaces with multiple dossiers and no selection to the cabinet dashboard', async () => {
    const store = TestBed.inject(AuthStore);
    store.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-firm'
    );
    cabinetDossiersApi.listDossiers.mockResolvedValue([
      {
        orgId: 'org-client-a',
        displayName: 'Client A',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      {
        orgId: 'org-client-b',
        displayName: 'Client B',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]);

    await store.loadDossiers();

    expect(store.activeDossierOrgId()).toBeNull();
    expect(store.workspaceDestination()).toBe('/cabinet/dashboard');
  });

  it('resolves persisted active dossier after reload from loaded dossiers', async () => {
    localStorage.setItem('liass-ohada.activeOrgId', 'org-firm');
    localStorage.setItem('liass-ohada.activeDossierOrgId', 'org-client');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      }
    ]);
    cabinetDossiersApi.listDossiers.mockResolvedValue([
      {
        orgId: 'org-client',
        displayName: 'Reloaded Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]);
    const store = TestBed.inject(AuthStore);

    await store.hydrate();
    await store.loadWorkspaces();
    await store.loadDossiers();

    expect(store.activeWorkspaceDisplayName()).toBe('Cabinet KPADONOU Conseil');
    expect(store.activeDossierDisplayName()).toBe('Reloaded Client SARL');
  });

  it('keeps a persisted active dossier usable when the dossier list is temporarily unavailable', async () => {
    localStorage.setItem('liass-ohada.activeOrgId', 'org-firm');
    localStorage.setItem('liass-ohada.activeDossierOrgId', 'org-client');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      }
    ]);
    cabinetDossiersApi.listDossiers.mockRejectedValue(new Error('Service unavailable'));
    const store = TestBed.inject(AuthStore);

    await store.hydrate();
    await store.loadWorkspaces();
    await store.loadDossiers();

    expect(store.activeWorkspaceType()).toBe('ACCOUNTING_FIRM');
    expect(store.activeDossierOrgId()).toBe('org-client');
    expect(store.hasActiveDossier()).toBe(true);
    expect(store.dossierError()).toBe('Service unavailable');
  });

  it('clears a persisted active dossier after a successful refresh proves it is not available', async () => {
    localStorage.setItem('liass-ohada.activeOrgId', 'org-firm');
    localStorage.setItem('liass-ohada.activeDossierOrgId', 'org-stale-client');
    workspacesApi.listWorkspaces.mockResolvedValue([
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      }
    ]);
    cabinetDossiersApi.listDossiers.mockResolvedValue([
      {
        orgId: 'org-current-client',
        displayName: 'Current Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]);
    const store = TestBed.inject(AuthStore);

    await store.hydrate();
    await store.loadWorkspaces();
    await store.loadDossiers();

    expect(store.activeDossierOrgId()).toBeNull();
    expect(store.hasActiveDossier()).toBe(false);
    expect(localStorage.getItem('liass-ohada.activeDossierOrgId')).toBeNull();
  });

  it('stores a newly created dossier as the active dossier immediately', () => {
    const store = TestBed.inject(AuthStore);
    store.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-firm'
    );

    store.setCreatedDossier(
      {
        orgId: 'org-client',
        displayName: 'Created Client SARL',
        country: 'BJ',
        accountingFramework: 'SYSCOHADA_REVISED',
        status: 'ACTIVE',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      },
      'org-client'
    );

    expect(store.activeDossierOrgId()).toBe('org-client');
    expect(store.activeDossierDisplayName()).toBe('Created Client SARL');
    expect(store.workspaceDestination()).toBe('/cabinet/dashboard');
  });

  it('adds a newly created dossier to the list without opening it', () => {
    const store = TestBed.inject(AuthStore);
    store.setCreatedWorkspace(
      {
        orgId: 'org-firm',
        displayName: 'Cabinet KPADONOU Conseil',
        workspaceType: 'ACCOUNTING_FIRM',
        cabinetId: 'cab-123'
      },
      'org-firm'
    );

    store.upsertDossier({
      orgId: 'org-client',
      displayName: 'Created Client SARL',
      country: 'BJ',
      accountingFramework: 'SYSCOHADA_REVISED',
      status: 'ACTIVE',
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    });

    expect(store.activeWorkspaceOrgId()).toBe('org-firm');
    expect(store.activeDossierOrgId()).toBeNull();
    expect(store.activeDossierDisplayName()).toBeNull();
    expect(store.dossiers().map((dossier) => dossier.orgId)).toEqual(['org-client']);
    expect(localStorage.getItem('liass-ohada.activeDossierOrgId')).toBeNull();
  });

  it('clears user and tenant state on logout', async () => {
    vi.mocked(signOut).mockResolvedValue(undefined);
    const store = TestBed.inject(AuthStore);
    store.setTenant('org-test');

    await store.logout();

    expect(store.user()).toBeNull();
    expect(store.activeOrgId()).toBeNull();
    expect(localStorage.getItem('liass-ohada.activeOrgId')).toBeNull();
    expect(localStorage.getItem('liass-ohada.activeDossierOrgId')).toBeNull();
  });

  it('starts Google hosted UI sign-in with account selection', async () => {
    vi.mocked(signInWithRedirect).mockResolvedValue(undefined);
    const store = TestBed.inject(AuthStore);

    await store.loginWithGoogle();

    expect(signInWithRedirect).toHaveBeenCalledWith({
      provider: 'Google',
      options: { prompt: 'SELECT_ACCOUNT' }
    });
  });

  it('starts LinkedIn hosted UI sign-in through the Cognito custom OIDC provider', async () => {
    vi.mocked(signInWithRedirect).mockResolvedValue(undefined);
    const store = TestBed.inject(AuthStore);

    await store.loginWithLinkedIn();

    expect(signInWithRedirect).toHaveBeenCalledWith({ provider: { custom: 'LinkedIn' } });
  });
});
