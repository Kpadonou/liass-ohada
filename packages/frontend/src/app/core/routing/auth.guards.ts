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

export const tenantGuard: CanActivateFn = async () => {
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

  if (authStore.activeWorkspaceType() === 'ACCOUNTING_FIRM') {
    if (authStore.activeDossierOrgId() && !authStore.dossiersLoaded()) {
      await authStore.loadDossiers();
    }

    return authStore.hasActiveDossier() ? true : router.createUrlTree(['/cabinet/dashboard']);
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
