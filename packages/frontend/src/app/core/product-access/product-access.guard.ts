import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ProductCodeSchema } from '@liass-ohada/shared/shared';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { ProductAccessQueries } from './product-access.queries';
import { resolveProductAvailability } from './product-availability';

/** Auth and tenant guards hydrate the context before this guard runs. */
export const productAccessGuard: CanActivateFn = async (route) => {
  const queries = inject(ProductAccessQueries);
  const queryClient = inject(QueryClient);
  const router = inject(Router);
  const productCode = ProductCodeSchema.safeParse(route.data['productCode']);
  const orgId = queries.activeOrgId();
  if (!productCode.success || !orgId) return router.createUrlTree(['/dashboard']);
  try {
    const access = await queryClient.fetchQuery(queries.list());
    // A workspace change during the request must not authorize the next workspace.
    if (
      queries.activeOrgId() === orgId &&
      resolveProductAvailability(access, productCode.data, true) === 'AVAILABLE'
    )
      return true;
  } catch {
    // Failure to verify access follows the same safe platform destination.
  }
  return router.createUrlTree(['/dashboard']);
};
