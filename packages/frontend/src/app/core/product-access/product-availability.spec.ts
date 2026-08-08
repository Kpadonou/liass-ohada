import type { ProductAccess, ProductCode } from '@liass-ohada/shared/shared';

import { resolveProductAvailability } from './product-availability';

const timestamp = '2026-08-07T10:00:00.000Z';
const access = (
  status: ProductAccess['status'],
  productCode: ProductCode = 'TREASURY',
): ProductAccess => ({
  orgId: 'org-a',
  productCode,
  status,
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('resolveProductAvailability', () => {
  it('marks ACTIVE as available', () => {
    expect(resolveProductAvailability([access('ACTIVE')], 'TREASURY', true)).toBe('AVAILABLE');
  });

  it.each([
    ['INACTIVE', [access('INACTIVE')]],
    ['missing', []],
  ] as const)('marks a known %s entitlement as unavailable', (_case, productAccess) => {
    expect(resolveProductAvailability(productAccess, 'TREASURY', true)).toBe('UNAVAILABLE');
  });

  it.each([
    ['loading', undefined, false],
    ['technical failure', undefined, false],
  ] as const)(
    'does not interpret %s as an inactive entitlement',
    (_case, productAccess, succeeded) => {
      expect(resolveProductAvailability(productAccess, 'TREASURY', succeeded)).toBe('UNKNOWN');
    },
  );

  it.each([
    ['ACTIVE', [access('ACTIVE', 'PROJECTS')], 'AVAILABLE'],
    ['INACTIVE', [access('INACTIVE', 'PROJECTS')], 'UNAVAILABLE'],
    ['missing', [], 'UNAVAILABLE'],
  ] as const)('resolves known PROJECTS %s access as %s', (_case, productAccess, expected) => {
    expect(resolveProductAvailability(productAccess, 'PROJECTS', true)).toBe(expected);
  });
});
