import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { CabinetDossierSummary, WorkspaceSummary } from '@liass-ohada/shared';
import type { AuthUser } from 'aws-amplify/auth';
import {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signInWithRedirect,
  signOut
} from 'aws-amplify/auth';

import { WorkspacesApi } from './workspaces.api';
import { CabinetDossiersApi } from './cabinet-dossiers.api';

const ACTIVE_ORG_STORAGE_KEY = 'liass-ohada.activeOrgId';
const ACTIVE_DOSSIER_STORAGE_KEY = 'liass-ohada.activeDossierOrgId';
const LINKEDIN_PROVIDER_NAME = 'LinkedIn';
const GOOGLE_SIGN_IN_PROMPT = 'SELECT_ACCOUNT';

export type WorkspaceDestination =
  | '/dashboard'
  | '/cabinet/dashboard'
  | '/onboarding'
  | '/select-workspace'
  | '/cabinet/dossiers/new'
  | '/cabinet/dossiers/select';
export type ActiveWorkspaceSummary = WorkspaceSummary & {
  cabinet?: { name?: string | null } | null;
  organization?: { name?: string | null } | null;
};
export type ActiveDossierSummary = CabinetDossierSummary | ActiveWorkspaceSummary;

interface AuthState {
  user: AuthUser | null;
  userAttributes: Record<string, string | undefined>;
  activeOrgId: string | null;
  loading: boolean;
  error: string | null;
  hydrated: boolean;
  requiresNewPassword: boolean;
  workspaces: ActiveWorkspaceSummary[];
  workspaceLoading: boolean;
  workspaceError: string | null;
  workspacesLoaded: boolean;
  activeDossierOrgId: string | null;
  dossiers: CabinetDossierSummary[];
  dossierLoading: boolean;
  dossierError: string | null;
  dossiersLoaded: boolean;
}

const initialState: AuthState = {
  user: null,
  userAttributes: {},
  activeOrgId: readStoredTenant(),
  loading: false,
  error: null,
  hydrated: false,
  requiresNewPassword: false,
  workspaces: [],
  workspaceLoading: false,
  workspaceError: null,
  workspacesLoaded: false,
  activeDossierOrgId: readStoredDossier(),
  dossiers: [],
  dossierLoading: false,
  dossierError: null,
  dossiersLoaded: false
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

function readStoredDossier(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const value = localStorage.getItem(ACTIVE_DOSSIER_STORAGE_KEY)?.trim();
  return value || null;
}

function persistDossier(orgId: string | null): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (orgId) {
    localStorage.setItem(ACTIVE_DOSSIER_STORAGE_KEY, orgId);
  } else {
    localStorage.removeItem(ACTIVE_DOSSIER_STORAGE_KEY);
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Authentication failed';
}

function isMissingDossierEndpoint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /404|not found|cannot match any routes|missing route/i.test(error.message)
  );
}

async function loadCurrentUserProfile(): Promise<{
  attributes: Record<string, string | undefined>;
  user: AuthUser;
}> {
  const user = await getCurrentUser();
  let tokenAttributes: Record<string, string | undefined> = {};

  try {
    const session = await fetchAuthSession({ forceRefresh: false });
    const payload = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;

    tokenAttributes = profileAttributesFromClaims(payload);
  } catch {
    tokenAttributes = {};
  }

  try {
    const attributes = await fetchUserAttributes();

    return {
      user,
      attributes: { ...tokenAttributes, ...(attributes ?? {}) }
    };
  } catch {
    return { user, attributes: tokenAttributes };
  }
}

function profileAttributesFromClaims(
  claims: Record<string, unknown> | undefined,
): Record<string, string | undefined> {
  if (!claims) {
    return {};
  }

  return ['email', 'name', 'given_name', 'family_name', 'picture'].reduce<
    Record<string, string | undefined>
  >((attributes, key) => {
    const value = claims[key];

    if (typeof value === 'string' && value.trim()) {
      attributes[key] = value;
    }

    return attributes;
  }, {});
}

function cleanDisplayValue(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed || /^google_/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function userEmail(
  user: AuthUser | null,
  attributes: Record<string, string | undefined>,
): string | null {
  return (
    cleanDisplayValue(attributes['email']) ??
    (user?.signInDetails?.loginId?.includes('@')
      ? cleanDisplayValue(user.signInDetails.loginId)
      : null) ??
    (user?.username?.includes('@') ? cleanDisplayValue(user.username) : null)
  );
}

function userDisplayName(
  user: AuthUser | null,
  attributes: Record<string, string | undefined>,
): string | null {
  const fullName = cleanDisplayValue(attributes['name']);
  const givenName = cleanDisplayValue(attributes['given_name']);
  const familyName = cleanDisplayValue(attributes['family_name']);
  const combinedName = [givenName, familyName].filter(Boolean).join(' ').trim();

  return fullName ?? cleanDisplayValue(combinedName) ?? userEmail(user, attributes);
}

function workspaceDisplayName(workspace: ActiveWorkspaceSummary | null): string | null {
  return (
    cleanDisplayValue(workspace?.displayName) ??
    cleanDisplayValue(workspace?.organization?.name ?? undefined) ??
    cleanDisplayValue(workspace?.cabinet?.name ?? undefined)
  );
}

function dossierDisplayName(dossier: ActiveDossierSummary | null): string | null {
  return cleanDisplayValue(dossier?.displayName);
}

function directWorkspaces(workspaces: ActiveWorkspaceSummary[]): ActiveWorkspaceSummary[] {
  return workspaces.filter((workspace) => workspace.accessSource !== 'CABINET');
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
  withComputed(({ user, userAttributes, activeOrgId, workspaces, activeDossierOrgId, dossiers }) => ({
    isAuthenticated: computed(() => !!user()),
    hasActiveTenant: computed(() => !!activeOrgId()),
    hasDiscoveredWorkspaces: computed(() => workspaces().length > 0),
    activeWorkspaceOrgId: computed(() => activeOrgId()),
    directWorkspaces: computed(() => directWorkspaces(workspaces())),
    canAccessDashboard: computed(() => !!user() && !!activeOrgId()),
    activeWorkspace: computed(() => {
      const orgId = activeOrgId();

      return orgId ? (workspaces().find((workspace) => workspace.orgId === orgId) ?? null) : null;
    }),
    activeWorkspaceDisplayName: computed(() => {
      const orgId = activeOrgId();
      const workspace = orgId
        ? (workspaces().find((candidate) => candidate.orgId === orgId) ?? null)
        : null;

      return workspaceDisplayName(workspace);
    }),
    activeWorkspaceType: computed(() =>
      activeOrgId()
        ? (workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType ??
          null)
        : null
    ),
    activeWorkspaceKind: computed(() =>
      activeOrgId()
        ? (workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType ??
          null)
        : null
    ),
    activeWorkspaceTypeLabelKey: computed(() => {
      const workspaceType = activeOrgId()
        ? workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType
        : null;

      if (workspaceType === 'ACCOUNTING_FIRM') {
        return 'SHELL.WORKSPACE_TYPES.ACCOUNTING_FIRM';
      }

      if (workspaceType === 'COMPANY') {
        return 'SHELL.WORKSPACE_TYPES.COMPANY';
      }

      return null;
    }),
    userDisplayName: computed(() => userDisplayName(user(), userAttributes())),
    userEmail: computed(() => userEmail(user(), userAttributes())),
    userPictureUrl: computed(() => cleanDisplayValue(userAttributes()['picture'])),
    currentUserDisplayName: computed(() => userDisplayName(user(), userAttributes())),
    currentUserEmail: computed(() => userEmail(user(), userAttributes())),
    currentUserPicture: computed(() => cleanDisplayValue(userAttributes()['picture'])),
    activeDossier: computed((): ActiveDossierSummary | null => {
      const orgId = activeOrgId();
      const workspace = orgId
        ? (workspaces().find((candidate) => candidate.orgId === orgId) ?? null)
        : null;

      if (workspace?.workspaceType === 'COMPANY') {
        return workspace;
      }

      if (workspace?.workspaceType !== 'ACCOUNTING_FIRM') {
        return null;
      }

      const dossierOrgId = activeDossierOrgId();

      return dossierOrgId
        ? (dossiers().find((dossier) => dossier.orgId === dossierOrgId) ?? null)
        : null;
    }),
    activeDossierDisplayName: computed(() => {
      const orgId = activeOrgId();
      const workspace = orgId
        ? (workspaces().find((candidate) => candidate.orgId === orgId) ?? null)
        : null;

      if (workspace?.workspaceType === 'COMPANY') {
        return workspaceDisplayName(workspace);
      }

      if (workspace?.workspaceType !== 'ACCOUNTING_FIRM') {
        return null;
      }

      const dossierOrgId = activeDossierOrgId();
      const dossier = dossierOrgId
        ? (dossiers().find((candidate) => candidate.orgId === dossierOrgId) ?? null)
        : null;

      return dossierDisplayName(dossier);
    }),
    hasActiveDossier: computed(() => {
      const orgId = activeOrgId();
      const workspace = orgId
        ? (workspaces().find((candidate) => candidate.orgId === orgId) ?? null)
        : null;

      if (workspace?.workspaceType === 'COMPANY') {
        return true;
      }

      if (workspace?.workspaceType !== 'ACCOUNTING_FIRM') {
        return false;
      }

      const dossierOrgId = activeDossierOrgId();

      return !!dossierOrgId && dossiers().some((dossier) => dossier.orgId === dossierOrgId);
    })
  })),
  withMethods((
    store,
    workspacesApi = inject(WorkspacesApi),
    cabinetDossiersApi = inject(CabinetDossiersApi)
  ) => ({
    async hydrate(): Promise<void> {
      patchState(store, {
        activeOrgId: readStoredTenant(),
        activeDossierOrgId: readStoredDossier(),
        loading: true,
        error: null
      });

      try {
        const { user, attributes } = await loadCurrentUserProfile();
        patchState(store, { user, userAttributes: attributes, loading: false, hydrated: true });
      } catch {
        patchState(store, { user: null, userAttributes: {}, loading: false, hydrated: true });
      }
    },

    async refreshUserProfile(): Promise<void> {
      try {
        const { user, attributes } = await loadCurrentUserProfile();
        patchState(store, {
          user,
          userAttributes: attributes,
          hydrated: true,
          error: null
        });
      } catch (error) {
        if (!store.user()) {
          patchState(store, {
            user: null,
            userAttributes: {},
            hydrated: true,
            error: messageFromError(error)
          });
        }
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

        const { user, attributes } = await loadCurrentUserProfile();
        patchState(store, {
          user,
          userAttributes: attributes,
          activeOrgId: readStoredTenant(),
          activeDossierOrgId: readStoredDossier(),
          loading: false,
          hydrated: true,
          requiresNewPassword: false,
          workspacesLoaded: false,
          workspaceError: null
        });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, {
          user: null,
          userAttributes: {},
          loading: false,
          error: message,
          requiresNewPassword: false
        });
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

        const { user, attributes } = await loadCurrentUserProfile();
        patchState(store, {
          user,
          userAttributes: attributes,
          activeOrgId: readStoredTenant(),
          activeDossierOrgId: readStoredDossier(),
          loading: false,
          hydrated: true,
          requiresNewPassword: false,
          workspacesLoaded: false,
          workspaceError: null
        });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, { user: null, userAttributes: {}, loading: false, error: message });
        throw error;
      }
    },

    async loadWorkspaces(force = false): Promise<ActiveWorkspaceSummary[]> {
      if (store.workspacesLoaded() && !force) {
        return store.workspaces();
      }

      patchState(store, {
        workspaceLoading: true,
        workspaceError: null
      });

      try {
        const workspaces = await workspacesApi.listWorkspaces();
        const directWorkspaceList = directWorkspaces(workspaces);
        const currentTenant = store.activeOrgId();
        const currentTenantIsValid = !!currentTenant && directWorkspaceList.some(
          (workspace) => workspace.orgId === currentTenant
        );

        if (directWorkspaceList.length === 1) {
          const directWorkspace = directWorkspaceList[0];
          const activeOrgId = applyTenantSelection(store, directWorkspace.orgId);
          const shouldClearDossier =
            currentTenant !== directWorkspace.orgId || directWorkspace.workspaceType === 'COMPANY';

          if (shouldClearDossier) {
            persistDossier(null);
          }

          patchState(store, {
            activeOrgId,
            activeDossierOrgId: shouldClearDossier ? null : store.activeDossierOrgId(),
            workspaces,
            workspaceLoading: false,
            workspaceError: null,
            workspacesLoaded: true
          });
          return workspaces;
        }

        if (!currentTenantIsValid) {
          const activeOrgId = applyTenantSelection(store, null);
          persistDossier(null);
          patchState(store, { activeOrgId, activeDossierOrgId: null });
        }

        patchState(store, {
          workspaces,
          workspaceLoading: false,
          workspaceError: null,
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

    workspaceDestination(): WorkspaceDestination | null {
      if (store.hasActiveTenant()) {
        if (store.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
          return '/cabinet/dashboard';
        }

        return '/dashboard';
      }

      if (store.workspaceLoading() || !store.workspacesLoaded()) {
        return null;
      }

      const workspaces = store.workspaces();
      const directWorkspaceList = directWorkspaces(workspaces);

      if (directWorkspaceList.length === 0) {
        return '/onboarding';
      }

      if (directWorkspaceList.length === 1) {
        const directWorkspace = directWorkspaceList[0];
        const previousActiveOrgId = store.activeOrgId();
        const activeOrgId = applyTenantSelection(store, directWorkspace.orgId);
        const shouldClearDossier =
          previousActiveOrgId !== directWorkspace.orgId || directWorkspace.workspaceType === 'COMPANY';

        if (shouldClearDossier) {
          persistDossier(null);
        }

        patchState(store, {
          activeOrgId,
          activeDossierOrgId: shouldClearDossier ? null : store.activeDossierOrgId(),
          error: null,
          workspaceError: null
        });

        return directWorkspace.workspaceType === 'ACCOUNTING_FIRM'
          ? '/cabinet/dashboard'
          : '/dashboard';
      }

      // TODO: Multi-direct-company workspaces are outside the MVP; keep this as a fallback.
      return '/select-workspace';
    },

    async logout(): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        await signOut();
      } finally {
        persistTenant(null);
        persistDossier(null);
        patchState(store, {
          user: null,
          userAttributes: {},
          activeOrgId: null,
          loading: false,
          error: null,
          hydrated: true,
          requiresNewPassword: false,
          workspaces: [],
          workspaceLoading: false,
          workspaceError: null,
          workspacesLoaded: false,
          activeDossierOrgId: null,
          dossiers: [],
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: false
        });
      }
    },

    async loginWithGoogle(): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        await signInWithRedirect({
          provider: 'Google',
          options: { prompt: GOOGLE_SIGN_IN_PROMPT }
        });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, { loading: false, error: message });
        throw error;
      }
    },

    async loginWithLinkedIn(): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        await signInWithRedirect({ provider: { custom: LINKEDIN_PROVIDER_NAME } });
      } catch (error) {
        const message = messageFromError(error);
        patchState(store, { loading: false, error: message });
        throw error;
      }
    },

    setTenant(orgId: string): void {
      const activeOrgId = applyTenantSelection(store, orgId);
      persistDossier(null);
      patchState(store, {
        activeOrgId,
        activeDossierOrgId: null,
        dossiers: [],
        dossierLoading: false,
        dossierError: null,
        dossiersLoaded: false,
        error: null,
        workspaceError: null
      });
    },

    setCreatedWorkspace(workspace: ActiveWorkspaceSummary, activeOrgId: string): void {
      const selectedOrgId = applyTenantSelection(store, activeOrgId);
      persistDossier(null);
      patchState(store, {
        activeOrgId: selectedOrgId,
        activeDossierOrgId: null,
        workspaces: [workspace],
        workspaceLoading: false,
        workspaceError: null,
        workspacesLoaded: true,
        dossiers: [],
        dossierLoading: false,
        dossierError: null,
        dossiersLoaded: workspace.workspaceType !== 'ACCOUNTING_FIRM',
        error: null
      });
    },

    async loadDossiers(force = false): Promise<CabinetDossierSummary[]> {
      if (store.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
        persistDossier(null);
        patchState(store, {
          activeDossierOrgId: null,
          dossiers: [],
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: true
        });
        return [];
      }

      if (store.dossiersLoaded() && !force) {
        return store.dossiers();
      }

      patchState(store, { dossierLoading: true, dossierError: null });

      try {
        const dossiers = await cabinetDossiersApi.listDossiers();
        const currentDossierOrgId = store.activeDossierOrgId();
        const currentDossierIsValid =
          !!currentDossierOrgId &&
          dossiers.some((dossier) => dossier.orgId === currentDossierOrgId);
        const selectedDossierOrgId = currentDossierIsValid ? currentDossierOrgId : null;

        persistDossier(selectedDossierOrgId);
        patchState(store, {
          activeDossierOrgId: selectedDossierOrgId,
          dossiers,
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: true
        });

        return dossiers;
      } catch (error) {
        const message = messageFromError(error);
        const dossierError = isMissingDossierEndpoint(error)
          ? 'IDENTITY.CABINET_DOSSIERS.ERRORS.SERVICE_UNAVAILABLE'
          : message;
        patchState(store, {
          dossierLoading: false,
          dossierError,
          dossiersLoaded: true
        });
        return [];
      }
    },

    setActiveDossier(orgId: string): void {
      const activeDossierOrgId = orgId.trim();

      if (!activeDossierOrgId) {
        return;
      }

      persistDossier(activeDossierOrgId);
      patchState(store, { activeDossierOrgId, dossierError: null });
    },

    setCreatedDossier(dossier: CabinetDossierSummary, activeDossierOrgId: string): void {
      const selectedDossierOrgId = activeDossierOrgId.trim();
      const existingDossiers = store.dossiers().filter(
        (candidate) => candidate.orgId !== dossier.orgId
      );

      persistDossier(selectedDossierOrgId);
      patchState(store, {
        activeDossierOrgId: selectedDossierOrgId,
        dossiers: [...existingDossiers, dossier],
        dossierLoading: false,
        dossierError: null,
        dossiersLoaded: true
      });
    }
  }))
);
