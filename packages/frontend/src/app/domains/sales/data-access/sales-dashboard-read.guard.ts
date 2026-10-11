import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SalesCapabilities } from './sales-capabilities';

/** Reuses the same permission projection as the existing Sales read surfaces. */
export const salesDashboardReadGuard: CanActivateFn = () =>
  inject(SalesCapabilities).canRead() || inject(Router).createUrlTree(['/dashboard']);
