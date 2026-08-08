import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';

export type ProductAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export function resolveProductAvailability(
  productAccess: readonly ProductAccess[] | undefined,
  productCode: ProductCode,
  querySucceeded: boolean,
): ProductAvailability {
  if (!querySucceeded || !productAccess) {
    return 'UNKNOWN';
  }

  return productAccess.some(
    (access) => access.productCode === productCode && access.status === 'ACTIVE',
  )
    ? 'AVAILABLE'
    : 'UNAVAILABLE';
}
