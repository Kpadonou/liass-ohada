import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { AuthUser } from 'aws-amplify/auth';
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth';

const ACTIVE_ORG_STORAGE_KEY = 'liass-ohada.activeOrgId';

interface AuthState {
  user: AuthUser | null;
  activeOrgId: string | null;
  loading: boolean;
  error: string | null;
  hydrated: boolean;
}

const initialState: AuthState = {
  user: null,
  activeOrgId: readStoredTenant(),
  loading: false,
  error: null,
  hydrated: false
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

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ user, activeOrgId }) => ({
    isAuthenticated: computed(() => !!user()),
    hasActiveTenant: computed(() => !!activeOrgId()),
    canAccessDashboard: computed(() => !!user() && !!activeOrgId())
  })),
  withMethods((store) => ({
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

        if (result.nextStep.signInStep !== 'DONE') {
          throw new Error(`Unsupported sign-in challenge: ${result.nextStep.signInStep}`);
        }

        const user = await getCurrentUser();
        patchState(store, {
          user,
          activeOrgId: readStoredTenant(),
          loading: false,
          hydrated: true
        });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, { user: null, loading: false, error: message });
        throw error;
      }
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
          hydrated: true
        });
      }
    },

    setTenant(orgId: string): void {
      const activeOrgId = orgId.trim() || null;
      persistTenant(activeOrgId);
      patchState(store, { activeOrgId, error: null });
    }
  }))
);
