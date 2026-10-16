import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { restaurantMemberMode } from './restaurant-access-state';

/** ProductAccess guards still verify entitlement; this guard selects implemented member workspaces. */
export const restaurantRouteGuard: CanActivateChildFn = (route) => {
  const auth = inject(AuthStore),
    caps = inject(RestaurantsCapabilities),
    router = inject(Router);
  const mode = restaurantMemberMode(auth.activeWorkspace(), auth.effectiveOrgId());
  const path = route.routeConfig?.path ?? '';
  if (mode === 'service')
    return path === 'service' ? true : router.createUrlTree(['/restaurants/service']);
  if (mode !== 'management') return path === '' ? true : router.createUrlTree(['/restaurants']);
  const allowed =
    path === 'service'
      ? caps.canReadService()
      : path === 'setup/team'
        ? caps.canReadStaff()
        : path === 'menu'
          ? caps.canManageMenu()
          : caps.canManageSetup();
  return allowed ? true : router.createUrlTree(['/restaurants']);
};
