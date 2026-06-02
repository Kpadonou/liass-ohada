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

  if (!authStore.hasActiveTenant()) {
    await authStore.loadWorkspaces();
  }

  const destination = authStore.workspaceDestination();

  if (destination === '/dashboard') {
    return true;
  }

  return destination ? router.createUrlTree([destination]) : false;
};

export const loginRedirectGuard: CanActivateFn = async () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await ensureHydrated(authStore);

  if (!authStore.isAuthenticated()) {
    return true;
  }

  if (!authStore.hasActiveTenant()) {
    await authStore.loadWorkspaces();
  }

  const destination = authStore.workspaceDestination();

  return destination ? router.createUrlTree([destination]) : false;
};
