import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';

import { resolveProductAvailability } from './product-availability';

const timestamp = '2026-08-07T10:00:00.000Z';
const access = (
  status: ProductAccess['status'],
  productCode: ProductCode = 'ACCOUNTING',
): ProductAccess => ({
  orgId: 'org-a',
  productCode,
  status,
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('resolveProductAvailability', () => {
  it('marks ACTIVE as available', () => {
    expect(resolveProductAvailability([access('ACTIVE')], 'ACCOUNTING', true)).toBe('AVAILABLE');
  });

  it.each([
    ['INACTIVE', [access('INACTIVE')]],
    ['missing', []],
  ] as const)('marks a known %s entitlement as unavailable', (_case, productAccess) => {
    expect(resolveProductAvailability(productAccess, 'ACCOUNTING', true)).toBe('UNAVAILABLE');
  });

  it.each([
    ['loading', undefined, false],
    ['technical failure', undefined, false],
  ] as const)(
    'does not interpret %s as an inactive entitlement',
    (_case, productAccess, succeeded) => {
      expect(resolveProductAvailability(productAccess, 'ACCOUNTING', succeeded)).toBe('UNKNOWN');
    },
  );

});
