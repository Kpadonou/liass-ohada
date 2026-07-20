import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthStore } from '../../domains/identity/data-access/auth.store';

async function ensureHydrated(authStore: InstanceType<typeof AuthStore>): Promise<void> {
  if (!authStore.hydrated()) {
    await authStore.hydrate();
  }
}

export const authGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  return authStore.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

export const appRootRedirectGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (!authStore.hasActiveTenant() || !authStore.workspacesLoaded()) {
    await authStore.loadWorkspaces();
  }

  const destination = authStore.workspaceDestination();

  return destination ? router.createUrlTree([destination]) : false;
};

function isCabinetRoute(url: string | undefined): boolean {
  const path = url?.split('?')[0]?.split('#')[0] ?? '';
  return path.startsWith('/cabinet/');
}

function isRootRoute(url: string | undefined): boolean {
  const path = url?.split('?')[0]?.split('#')[0] ?? '';
  return path === '/';
}

export const tenantGuard: CanActivateFn = async (_route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (!authStore.hasActiveTenant() || !authStore.workspacesLoaded()) {
    await authStore.loadWorkspaces();
  }

  const destination = authStore.workspaceDestination();

  if (isRootRoute(state.url)) {
    return destination ? router.createUrlTree([destination]) : false;
  }

  if (authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
    if (isCabinetRoute(state.url)) {
      authStore.enterCabinetContext();
      return true;
    }

    const persistedDossierOrgId = authStore.activeDossierOrgId();
    if (!authStore.dossiersLoaded()) {
      await authStore.loadDossiers();
    }

    if (authStore.hasActiveDossier()) {
      return true;
    }

    authStore.enterCabinetContext();
    return persistedDossierOrgId
      ? router.createUrlTree(['/cabinet/dossiers'], {
          queryParams: { contextRecovery: '1' }
        })
      : router.createUrlTree(['/cabinet/dashboard']);
  }

  if (destination === '/dashboard') {
    return true;
  }

  return destination ? router.createUrlTree([destination]) : false;
};

export const cabinetDashboardGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (!authStore.hasActiveTenant() || !authStore.workspacesLoaded()) {
    await authStore.loadWorkspaces();
  }

  if (authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
    authStore.enterCabinetContext();
    return true;
  }

  const destination = authStore.workspaceDestination();

  return router.createUrlTree([
    destination === '/cabinet/dashboard' ? '/dashboard' : (destination ?? '/dashboard')
  ]);
};

export const cabinetDossierGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  if (!authStore.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (!authStore.hasActiveTenant() || !authStore.workspacesLoaded()) {
    await authStore.loadWorkspaces();
  }

  if (authStore.activeWorkspaceType() !== 'ACCOUNTING_FIRM') {
    return router.createUrlTree(['/dashboard']);
  }

  if (!authStore.dossiersLoaded()) {
    await authStore.loadDossiers();
  }

  return true;
};

export const accountingWriteGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  await ensureHydrated(authStore);
  if (!authStore.workspacesLoaded()) {
    await authStore.loadWorkspaces();
  }
  if (authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM' && !authStore.dossiersLoaded()) {
    await authStore.loadDossiers(true);
  }
  return authStore.canWriteAccounting()
    ? true
    : router.createUrlTree(['/accounting/entries']);
};

export const loginRedirectGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  if (!authStore.isAuthenticated()) {
    return true;
  }

  if (!authStore.hasActiveTenant() || !authStore.workspacesLoaded()) {
    await authStore.loadWorkspaces();
  }

  const destination = authStore.workspaceDestination();

  return destination ? router.createUrlTree([destination]) : false;
};
