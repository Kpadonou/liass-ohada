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
  if (path === 'context') return true;
  if (path === 'inventory')
    return caps.canManageInventory() ? true : router.createUrlTree(['/restaurants']);
  if (path === 'service/outlets/:outletId/sessions/:guestSessionId')
    return caps.canReadSession() ? true : router.createUrlTree(['/restaurants']);
  if (path === 'outlets/:outletId/sessions/:sessionId/receipt')
    return caps.canReadReceipt() ? true : router.createUrlTree(['/restaurants']);
  if (path === 'cash' || path === 'cash/day')
    return (path === 'cash/day' ? caps.canManageSetup() : caps.canReadCheckout())
      ? true
      : router.createUrlTree(['/restaurants']);
  if (path === 'checkout')
    return caps.canReadCheckout() ? true : router.createUrlTree(['/restaurants']);
  if (mode === 'checkout') return router.createUrlTree(['/restaurants/checkout']);
  if (mode === 'kitchen')
    return path === 'kitchen' ? true : router.createUrlTree(['/restaurants/kitchen']);
  if (path === 'kitchen')
    return caps.canReadKitchen() ? true : router.createUrlTree(['/restaurants']);
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
