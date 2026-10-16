import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type {
  AccountingAccessMode,
  CabinetDossierSummary,
  WorkspaceSummary,
} from '@liass-ohada/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';
import type { AuthUser } from 'aws-amplify/auth';
import {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signInWithRedirect,
  signOut,
} from 'aws-amplify/auth';

import { WorkspacesApi } from './workspaces.api';
import { CabinetDossiersApi } from './cabinet-dossiers.api';
import { clearInvitationAcceptanceState } from './invitation-acceptance-state';

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
  contextRevision: number;
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
  dossierOpeningOrgId: string | null;
  dossiers: CabinetDossierSummary[];
  dossierLoading: boolean;
  dossierError: string | null;
  dossiersLoaded: boolean;
}

const initialState: AuthState = {
  contextRevision: 0,
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
  dossierOpeningOrgId: null,
  dossiers: [],
  dossierLoading: false,
  dossierError: null,
  dossiersLoaded: false,
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

async function loadCurrentUserProfile(
  options: { allowUserAttributeFetch?: boolean } = {},
): Promise<{
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

  if (hasReadableProfileAttributes(tokenAttributes)) {
    return { user, attributes: tokenAttributes };
  }

  if (!options.allowUserAttributeFetch) {
    return { user, attributes: tokenAttributes };
  }

  try {
    const attributes = await fetchUserAttributes();

    return {
      user,
      attributes: { ...tokenAttributes, ...(attributes ?? {}) },
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

function hasReadableProfileAttributes(attributes: Record<string, string | undefined>): boolean {
  return Boolean(
    cleanDisplayValue(attributes['name']) ||
    cleanDisplayValue(attributes['email']) ||
    cleanDisplayValue(attributes['given_name']) ||
    cleanDisplayValue(attributes['family_name']),
  );
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

function clearTenantQueries(queryClient: QueryClient | null, orgId?: string | null): void {
  if (!queryClient) {
    return;
  }

  const tenantRoots = [
    'restaurants',
    'sales',
    'product-access',
    'identity',
    'accounting',
    'treasury',
    'projects',
    'cabinet-dashboard',
    'cabinet-settings',
    'cabinet-team',
    'cabinet-operations',
  ] as const;

  for (const root of tenantRoots) {
    const filters = orgId ? { queryKey: [root, orgId] } : { queryKey: [root] };
    void queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
  }
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(
    ({
      user,
      userAttributes,
      activeOrgId,
      workspaces,
      activeDossierOrgId,
      dossiers,
      dossiersLoaded,
      dossierError,
      dossierOpeningOrgId,
    }) => ({
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
          : null,
      ),
      activeWorkspaceKind: computed(() =>
        activeOrgId()
          ? (workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType ??
            null)
          : null,
      ),
      workspaceType: computed(() =>
        activeOrgId()
          ? (workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType ??
            null)
          : null,
      ),
      accessSource: computed(() => {
        const workspace = activeOrgId()
          ? workspaces().find((candidate) => candidate.orgId === activeOrgId())
          : null;

        return workspace?.workspaceType === 'ACCOUNTING_FIRM'
          ? 'CABINET'
          : (workspace?.accessSource ?? null);
      }),
      isDirectCompanyContext: computed(
        () =>
          workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType ===
          'COMPANY',
      ),
      isCabinetContext: computed(
        () =>
          workspaces().find((workspace) => workspace.orgId === activeOrgId())?.workspaceType ===
            'ACCOUNTING_FIRM' && !activeDossierOrgId(),
      ),
      isDossierContext: computed(() => {
        const workspaceType = workspaces().find(
          (workspace) => workspace.orgId === activeOrgId(),
        )?.workspaceType;

        if (workspaceType === 'COMPANY') {
          return true;
        }

        const dossierOrgId = activeDossierOrgId();
        return (
          workspaceType === 'ACCOUNTING_FIRM' &&
          !!dossierOrgId &&
          dossiersLoaded() &&
          !dossierError() &&
          dossiers().some(
            (dossier) => dossier.orgId === dossierOrgId && dossier.status === 'ACTIVE',
          )
        );
      }),
      effectiveOrgId: computed(() => {
        const workspaceType = workspaces().find(
          (workspace) => workspace.orgId === activeOrgId(),
        )?.workspaceType;

        if (workspaceType === 'COMPANY') {
          return activeOrgId();
        }

        const dossierOrgId = activeDossierOrgId();
        return workspaceType === 'ACCOUNTING_FIRM' &&
          dossierOrgId &&
          dossiersLoaded() &&
          !dossierError() &&
          dossiers().some(
            (dossier) => dossier.orgId === dossierOrgId && dossier.status === 'ACTIVE',
          )
          ? dossierOrgId
          : null;
      }),
      dossierOpening: computed(() => !!dossierOpeningOrgId()),
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
      currentUserId: computed(() => user()?.userId ?? null),
      activeCabinetRole: computed(() => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        return workspace?.workspaceType === 'ACCOUNTING_FIRM'
          ? (workspace.cabinetRole ?? null)
          : null;
      }),
      canViewCabinetTeam: computed(() => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        return (
          workspace?.workspaceType === 'ACCOUNTING_FIRM' &&
          workspace.status === 'ACTIVE' &&
          (workspace.cabinetRole === 'CABINET_ADMIN' || workspace.cabinetRole === 'SUPERVISOR')
        );
      }),
      canViewCabinetInvitations: computed(() => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        return (
          workspace?.workspaceType === 'ACCOUNTING_FIRM' &&
          workspace.status === 'ACTIVE' &&
          workspace.cabinetRole === 'CABINET_ADMIN'
        );
      }),
      activeDossier: computed((): ActiveDossierSummary | null => {
        const orgId = activeOrgId();
        const workspace = orgId
          ? (workspaces().find((candidate) => candidate.orgId === orgId) ?? null)
          : null;

        if (workspace?.workspaceType === 'COMPANY') {
          return null;
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
          return null;
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

        return (
          !!dossierOrgId &&
          dossiersLoaded() &&
          !dossierError() &&
          dossiers().some(
            (dossier) => dossier.orgId === dossierOrgId && dossier.status === 'ACTIVE',
          )
        );
      }),
      activeAccountingAccessMode: computed((): AccountingAccessMode | null => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        if (workspace?.workspaceType === 'COMPANY') {
          return 'READ_WRITE';
        }
        if (workspace?.workspaceType !== 'ACCOUNTING_FIRM') {
          return null;
        }
        const dossier = dossiers().find(
          (candidate) => candidate.orgId === activeDossierOrgId() && candidate.status === 'ACTIVE',
        );
        return dossier?.accessMode ?? null;
      }),
      canReadAccounting: computed(() => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        if (workspace?.workspaceType === 'COMPANY') return true;
        const dossier = dossiers().find(
          (candidate) => candidate.orgId === activeDossierOrgId() && candidate.status === 'ACTIVE',
        );
        return dossier?.accessMode === 'READ_WRITE' || dossier?.accessMode === 'READ_ONLY';
      }),
      canWriteAccounting: computed(() => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        if (workspace?.workspaceType === 'COMPANY') return true;
        return dossiers().some(
          (candidate) =>
            candidate.orgId === activeDossierOrgId() &&
            candidate.status === 'ACTIVE' &&
            candidate.accessMode === 'READ_WRITE',
        );
      }),
      isAccountingReadOnly: computed(() => {
        const workspace = workspaces().find((candidate) => candidate.orgId === activeOrgId());
        if (workspace?.workspaceType !== 'ACCOUNTING_FIRM') return false;
        return dossiers().some(
          (candidate) =>
            candidate.orgId === activeDossierOrgId() &&
            candidate.status === 'ACTIVE' &&
            candidate.accessMode === 'READ_ONLY',
        );
      }),
    }),
  ),
  withMethods(
    (
      store,
      workspacesApi = inject(WorkspacesApi),
      cabinetDossiersApi = inject(CabinetDossiersApi),
      queryClient = inject(QueryClient, { optional: true }),
    ) => ({
      invalidateSessionContext(): void {
        void queryClient?.cancelQueries();
        queryClient?.clear();
        clearInvitationAcceptanceState();
        patchState(store, {
          ...initialState,
          activeOrgId: null,
          activeDossierOrgId: null,
          contextRevision: store.contextRevision() + 1,
          hydrated: true,
        });
      },

      async hydrate(): Promise<void> {
        const revision = store.contextRevision();
        patchState(store, {
          activeOrgId: readStoredTenant(),
          activeDossierOrgId: readStoredDossier(),
          loading: true,
          error: null,
        });

        try {
          const { user, attributes } = await loadCurrentUserProfile();
          if (revision !== store.contextRevision()) return;
          if (store.currentUserId() && store.currentUserId() !== user.userId)
            this.invalidateSessionContext();
          patchState(store, { user, userAttributes: attributes, loading: false, hydrated: true });
        } catch {
          if (revision !== store.contextRevision()) return;
          this.invalidateSessionContext();
        }
      },

      async refreshUserProfile(): Promise<void> {
        const revision = store.contextRevision();
        try {
          const { user, attributes } = await loadCurrentUserProfile();
          if (revision !== store.contextRevision()) return;
          if (store.currentUserId() !== user.userId) this.invalidateSessionContext();
          patchState(store, {
            user,
            userAttributes: attributes,
            hydrated: true,
            error: null,
          });
        } catch (error) {
          if (revision !== store.contextRevision()) return;
          if (!store.user()) {
            patchState(store, {
              user: null,
              userAttributes: {},
              hydrated: true,
              error: messageFromError(error),
            });
          }
        }
      },

      async login(email: string, password: string): Promise<void> {
        const revision = store.contextRevision();
        patchState(store, { loading: true, error: null });

        try {
          const result = await signIn({ username: email, password });
          if (revision !== store.contextRevision()) return;

          if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
            patchState(store, {
              loading: false,
              error: null,
              requiresNewPassword: true,
              hydrated: true,
            });
            return;
          }

          if (result.nextStep.signInStep !== 'DONE') {
            throw new Error(`Unsupported sign-in challenge: ${result.nextStep.signInStep}`);
          }

          const { user, attributes } = await loadCurrentUserProfile({
            allowUserAttributeFetch: true,
          });
          if (revision !== store.contextRevision()) return;
          if (store.currentUserId() !== user.userId) this.invalidateSessionContext();
          patchState(store, {
            user,
            userAttributes: attributes,
            activeOrgId: readStoredTenant(),
            activeDossierOrgId: readStoredDossier(),
            loading: false,
            hydrated: true,
            requiresNewPassword: false,
            workspacesLoaded: false,
            workspaceError: null,
          });
        } catch (error) {
          if (revision !== store.contextRevision()) return;
          const message = messageFromError(error);
          patchState(store, {
            user: null,
            userAttributes: {},
            loading: false,
            error: message,
            requiresNewPassword: false,
          });
          throw error;
        }
      },

      async confirmNewPassword(newPassword: string): Promise<void> {
        const revision = store.contextRevision();
        patchState(store, { loading: true, error: null });

        try {
          const result = await confirmSignIn({ challengeResponse: newPassword });
          if (revision !== store.contextRevision()) return;

          if (result.nextStep.signInStep !== 'DONE') {
            throw new Error(`Unsupported sign-in challenge: ${result.nextStep.signInStep}`);
          }

          const { user, attributes } = await loadCurrentUserProfile({
            allowUserAttributeFetch: true,
          });
          if (revision !== store.contextRevision()) return;
          if (store.currentUserId() !== user.userId) this.invalidateSessionContext();
          patchState(store, {
            user,
            userAttributes: attributes,
            activeOrgId: readStoredTenant(),
            activeDossierOrgId: readStoredDossier(),
            loading: false,
            hydrated: true,
            requiresNewPassword: false,
            workspacesLoaded: false,
            workspaceError: null,
          });
        } catch (error) {
          if (revision !== store.contextRevision()) return;
          const message = messageFromError(error);
          patchState(store, { user: null, userAttributes: {}, loading: false, error: message });
          throw error;
        }
      },

      async loadWorkspaces(force = false): Promise<ActiveWorkspaceSummary[]> {
        if (store.workspacesLoaded() && !force) {
          return store.workspaces();
        }

        const revision = store.contextRevision();
        const userId = store.currentUserId();
        patchState(store, {
          workspaceLoading: true,
          workspaceError: null,
        });

        try {
          const workspaces = await workspacesApi.listWorkspaces();
          if (revision !== store.contextRevision() || userId !== store.currentUserId()) return [];
          const directWorkspaceList = directWorkspaces(workspaces);
          const currentTenant = store.activeOrgId();
          const currentTenantIsValid =
            !!currentTenant &&
            directWorkspaceList.some((workspace) => workspace.orgId === currentTenant);

          if (directWorkspaceList.length === 1) {
            const directWorkspace = directWorkspaceList[0];
            const activeOrgId = applyTenantSelection(store, directWorkspace.orgId);
            const shouldClearDossier =
              currentTenant !== directWorkspace.orgId ||
              directWorkspace.workspaceType === 'COMPANY';

            if (shouldClearDossier) {
              persistDossier(null);
            }

            patchState(store, {
              activeOrgId,
              activeDossierOrgId: shouldClearDossier ? null : store.activeDossierOrgId(),
              workspaces,
              workspaceLoading: false,
              workspaceError: null,
              workspacesLoaded: true,
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
            workspacesLoaded: true,
          });

          return workspaces;
        } catch (error) {
          if (revision !== store.contextRevision() || userId !== store.currentUserId()) return [];
          const message = messageFromError(error);
          patchState(store, {
            workspaceLoading: false,
            workspaceError: message,
            workspacesLoaded: true,
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
            previousActiveOrgId !== directWorkspace.orgId ||
            directWorkspace.workspaceType === 'COMPANY';

          if (shouldClearDossier) {
            persistDossier(null);
          }

          patchState(store, {
            activeOrgId,
            activeDossierOrgId: shouldClearDossier ? null : store.activeDossierOrgId(),
            error: null,
            workspaceError: null,
          });

          return directWorkspace.workspaceType === 'ACCOUNTING_FIRM'
            ? '/cabinet/dashboard'
            : '/dashboard';
        }

        return '/select-workspace';
      },

      async logout(): Promise<void> {
        this.invalidateSessionContext();
        patchState(store, { loading: true, error: null });

        try {
          await signOut();
        } finally {
          this.invalidateSessionContext();
          clearInvitationAcceptanceState();
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
            dossierOpeningOrgId: null,
            dossiers: [],
            dossierLoading: false,
            dossierError: null,
            dossiersLoaded: false,
          });
        }
      },

      async loginWithGoogle(): Promise<void> {
        patchState(store, { loading: true, error: null });

        try {
          await signInWithRedirect({
            provider: 'Google',
            options: { prompt: GOOGLE_SIGN_IN_PROMPT },
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
        const previousWorkspaceOrgId = store.activeOrgId();
        const previousDossierOrgId = store.activeDossierOrgId();
        const activeOrgId = applyTenantSelection(store, orgId);
        persistDossier(null);
        clearTenantQueries(queryClient, previousDossierOrgId);
        if (previousWorkspaceOrgId !== activeOrgId) {
          clearTenantQueries(queryClient, previousWorkspaceOrgId);
        }
        patchState(store, {
          activeOrgId,
          contextRevision: store.contextRevision() + 1,
          activeDossierOrgId: null,
          dossierOpeningOrgId: null,
          dossiers: [],
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: false,
          error: null,
          workspaceError: null,
        });
      },

      setCreatedWorkspace(workspace: ActiveWorkspaceSummary, activeOrgId: string): void {
        const selectedOrgId = applyTenantSelection(store, activeOrgId);
        persistDossier(null);
        patchState(store, {
          activeOrgId: selectedOrgId,
          activeDossierOrgId: null,
          dossierOpeningOrgId: null,
          workspaces: [workspace],
          workspaceLoading: false,
          workspaceError: null,
          workspacesLoaded: true,
          dossiers: [],
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: workspace.workspaceType !== 'ACCOUNTING_FIRM',
          error: null,
        });
      },

      async loadDossiers(force = false): Promise<CabinetDossierSummary[]> {
        if (store.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
          persistDossier(null);
          patchState(store, {
            activeDossierOrgId: null,
            dossierOpeningOrgId: null,
            dossiers: [],
            dossierLoading: false,
            dossierError: null,
            dossiersLoaded: true,
          });
          return [];
        }

        if (store.dossiersLoaded() && !force) {
          return store.dossiers();
        }

        const revision = store.contextRevision();
        patchState(store, { dossierLoading: true, dossierError: null });

        try {
          const dossiers = await cabinetDossiersApi.listDossiers();
          if (revision !== store.contextRevision()) return [];
          const currentDossierOrgId = store.activeDossierOrgId();
          const currentDossierIsValid =
            !!currentDossierOrgId &&
            dossiers.some((dossier) => dossier.orgId === currentDossierOrgId);
          const selectedDossierOrgId = currentDossierIsValid ? currentDossierOrgId : null;

          if (currentDossierOrgId && !selectedDossierOrgId) {
            clearTenantQueries(queryClient, currentDossierOrgId);
          }

          persistDossier(selectedDossierOrgId);
          patchState(store, {
            activeDossierOrgId: selectedDossierOrgId,
            dossiers,
            dossierLoading: false,
            dossierError: null,
            dossiersLoaded: true,
          });

          return dossiers;
        } catch (error) {
          if (revision !== store.contextRevision()) return [];
          const dossierError = isMissingDossierEndpoint(error)
            ? 'IDENTITY.CABINET_DOSSIERS.ERRORS.SERVICE_UNAVAILABLE'
            : 'IDENTITY.CABINET_DOSSIERS.ERRORS.LOAD_FAILED';
          persistDossier(null);
          patchState(store, {
            activeDossierOrgId: null,
            dossierLoading: false,
            dossierError,
            dossiersLoaded: true,
          });
          return [];
        }
      },

      setActiveDossier(orgId: string): boolean {
        const activeDossierOrgId = orgId.trim();

        const dossier = store
          .dossiers()
          .find(
            (candidate) => candidate.orgId === activeDossierOrgId && candidate.status === 'ACTIVE',
          );
        if (store.activeWorkspaceType() !== 'ACCOUNTING_FIRM' || !dossier) {
          persistDossier(null);
          patchState(store, {
            activeDossierOrgId: null,
            dossierError: 'IDENTITY.CABINET_DOSSIERS.ERRORS.OPEN_FAILED',
          });
          return false;
        }

        clearTenantQueries(queryClient, store.activeDossierOrgId());
        persistDossier(activeDossierOrgId);
        patchState(store, { activeDossierOrgId, dossierError: null });
        return true;
      },

      async openDossier(orgId: string): Promise<boolean> {
        const dossierOrgId = orgId.trim();
        if (!dossierOrgId || store.dossierOpeningOrgId()) {
          return false;
        }

        patchState(store, { dossierOpeningOrgId: dossierOrgId, dossierError: null });
        try {
          await this.loadDossiers(true);
          return this.setActiveDossier(dossierOrgId);
        } finally {
          patchState(store, { dossierOpeningOrgId: null });
        }
      },

      enterCabinetContext(): void {
        const previousDossierOrgId = store.activeDossierOrgId();
        persistDossier(null);
        clearTenantQueries(queryClient, previousDossierOrgId);
        patchState(store, {
          activeDossierOrgId: null,
          dossierOpeningOrgId: null,
          dossierError: null,
        });
      },

      handleAccountingAuthorizationFailure(code: string | null): void {
        if (code === 'CABINET_DOSSIER_READ_ONLY') {
          void this.loadDossiers(true);
          return;
        }
        const accessRevokedCodes = new Set([
          'CABINET_DOSSIER_ASSIGNMENT_REQUIRED',
          'CABINET_DOSSIER_ACCESS_FORBIDDEN',
          'CABINET_DOSSIER_ACCESS_REVOKED',
          'CABINET_DOSSIER_NOT_OWNED',
          'CABINET_DOSSIER_INACTIVE',
          'CABINET_MEMBER_NOT_ACTIVE',
          'ACCOUNTING_ACCESS_CONTEXT_INVALID',
          'ERROR_ORG_ACCESS_DENIED',
        ]);
        if (!code || !accessRevokedCodes.has(code)) {
          return;
        }
        const previousDossierOrgId = store.activeDossierOrgId();
        persistDossier(null);
        clearTenantQueries(queryClient, previousDossierOrgId);
        patchState(store, {
          activeDossierOrgId: null,
          dossierError: 'IDENTITY.CABINET_DOSSIERS.ERRORS.ACCESS_REVOKED',
          dossiersLoaded: false,
        });
      },

      setCreatedDossier(dossier: CabinetDossierSummary, activeDossierOrgId: string): void {
        const selectedDossierOrgId = activeDossierOrgId.trim();
        const existingDossiers = store
          .dossiers()
          .filter((candidate) => candidate.orgId !== dossier.orgId);

        persistDossier(selectedDossierOrgId);
        patchState(store, {
          activeDossierOrgId: selectedDossierOrgId,
          dossierOpeningOrgId: null,
          dossiers: [...existingDossiers, dossier],
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: true,
        });
      },

      upsertDossier(dossier: CabinetDossierSummary): void {
        const existingDossiers = store
          .dossiers()
          .filter((candidate) => candidate.orgId !== dossier.orgId);

        patchState(store, {
          dossiers: [...existingDossiers, dossier],
          dossierLoading: false,
          dossierError: null,
          dossiersLoaded: true,
        });
      },
    }),
  ),
);
