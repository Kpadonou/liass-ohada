import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { WorkspaceSummary } from '@liass-ohada/shared';
import type { AuthUser } from 'aws-amplify/auth';
import { confirmSignIn, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';

import { WorkspacesApi } from './workspaces.api';

const ACTIVE_ORG_STORAGE_KEY = 'liass-ohada.activeOrgId';

interface AuthState {
  user: AuthUser | null;
  activeOrgId: string | null;
  loading: boolean;
  error: string | null;
  hydrated: boolean;
  requiresNewPassword: boolean;
  workspaces: WorkspaceSummary[];
  workspaceLoading: boolean;
  workspaceError: string | null;
  workspacesLoaded: boolean;
}

const initialState: AuthState = {
  user: null,
  activeOrgId: readStoredTenant(),
  loading: false,
  error: null,
  hydrated: false,
  requiresNewPassword: false,
  workspaces: [],
  workspaceLoading: false,
  workspaceError: null,
  workspacesLoaded: false
};

function readStoredTenant(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const value = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)?.trim();
  return value || null;
}

function persistTenant(orgId: string | null): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (orgId) {
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
  } else {
    localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Authentication failed';
}

function applyTenantSelection(
  store: {
    activeOrgId: () => string | null;
  },
  orgId: string | null,
): string | null {
  const activeOrgId = orgId?.trim() || null;
  persistTenant(activeOrgId);
  return activeOrgId;
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ user, activeOrgId, workspaces }) => ({
    isAuthenticated: computed(() => !!user()),
    hasActiveTenant: computed(() => !!activeOrgId()),
    hasDiscoveredWorkspaces: computed(() => workspaces().length > 0),
    canAccessDashboard: computed(() => !!user() && !!activeOrgId())
  })),
  withMethods((store, workspacesApi = inject(WorkspacesApi)) => ({
    async hydrate(): Promise<void> {
      patchState(store, {
        activeOrgId: readStoredTenant(),
        loading: true,
        error: null
      });

      try {
        const user = await getCurrentUser();
        patchState(store, { user, loading: false, hydrated: true });
      } catch {
        patchState(store, { user: null, loading: false, hydrated: true });
      }
    },

    async login(email: string, password: string): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        const result = await signIn({ username: email, password });

        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          patchState(store, {
            loading: false,
            error: null,
            requiresNewPassword: true,
            hydrated: true
          });
          return;
        }

        if (result.nextStep.signInStep !== 'DONE') {
          throw new Error(`Unsupported sign-in challenge: ${result.nextStep.signInStep}`);
        }

        const user = await getCurrentUser();
        patchState(store, {
          user,
          activeOrgId: readStoredTenant(),
          loading: false,
          hydrated: true,
          requiresNewPassword: false,
          workspacesLoaded: false,
          workspaceError: null
        });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, { user: null, loading: false, error: message, requiresNewPassword: false });
        throw error;
      }
    },

    async confirmNewPassword(newPassword: string): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        const result = await confirmSignIn({ challengeResponse: newPassword });

        if (result.nextStep.signInStep !== 'DONE') {
          throw new Error(`Unsupported sign-in challenge: ${result.nextStep.signInStep}`);
        }

        const user = await getCurrentUser();
        patchState(store, {
          user,
          activeOrgId: readStoredTenant(),
          loading: false,
          hydrated: true,
          requiresNewPassword: false,
          workspacesLoaded: false,
          workspaceError: null
        });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, { user: null, loading: false, error: message });
        throw error;
      }
    },

    async loadWorkspaces(force = false): Promise<WorkspaceSummary[]> {
      if (store.workspacesLoaded() && !force) {
        return store.workspaces();
      }

      patchState(store, {
        workspaceLoading: true,
        workspaceError: null
      });

      try {
        const workspaces = await workspacesApi.listWorkspaces();
        const currentTenant = store.activeOrgId();
        const currentTenantIsValid = !!currentTenant && workspaces.some(
          (workspace) => workspace.orgId === currentTenant
        );

        if (workspaces.length === 1) {
          const activeOrgId = applyTenantSelection(store, workspaces[0].orgId);
          patchState(store, {
            activeOrgId,
            workspaces,
            workspaceLoading: false,
            workspaceError: null,
            workspacesLoaded: true
          });
          return workspaces;
        }

        if (!currentTenantIsValid) {
          const activeOrgId = applyTenantSelection(store, null);
          patchState(store, { activeOrgId });
        }

        patchState(store, {
          workspaces,
          workspaceLoading: false,
          workspaceError: workspaces.length === 0 ? 'No workspace assigned.' : null,
          workspacesLoaded: true
        });

        return workspaces;
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, {
          workspaceLoading: false,
          workspaceError: message,
          workspacesLoaded: true
        });
        throw error;
      }
    },

    workspaceDestination(): '/dashboard' | '/select-workspace' {
      return store.hasActiveTenant() ? '/dashboard' : '/select-workspace';
    },

    async logout(): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        await signOut();
      } finally {
        persistTenant(null);
        patchState(store, {
          user: null,
          activeOrgId: null,
          loading: false,
          error: null,
          hydrated: true,
          requiresNewPassword: false,
          workspaces: [],
          workspaceLoading: false,
          workspaceError: null,
          workspacesLoaded: false
        });
      }
    },

    async loginWithGoogle(): Promise<void> {
      patchState(store, { loading: true, error: null });

      await Promise.resolve();

      patchState(store, {
        loading: false,
        error: 'Google sign-in is not configured yet.'
      });
    },

    setTenant(orgId: string): void {
      const activeOrgId = applyTenantSelection(store, orgId);
      patchState(store, { activeOrgId, error: null, workspaceError: null });
    }
  }))
);
