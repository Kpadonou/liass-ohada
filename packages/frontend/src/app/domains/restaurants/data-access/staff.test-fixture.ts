import type {
  RestaurantStaff,
  RestaurantStaffOutlet,
  Outlet,
} from '@liass-ohada/shared/restaurants';
import { rid } from './restaurants.test-fixture';
const dates = {
  version: 1,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
};
export const staffFixture = (
  userId = 'private-user-a',
  changes: Partial<RestaurantStaff> = {},
): RestaurantStaff => ({
  ...dates,
  userId,
  displayName: 'Aïssatou S.',
  restaurantRole: 'WAITER',
  status: 'ACTIVE',
  organizationMembershipActive: true,
  ...changes,
});
export const assignmentFixture = (
  outletId = rid(2),
  changes: Partial<RestaurantStaffOutlet> = {},
): RestaurantStaffOutlet => ({
  ...dates,
  userId: 'private-user-a',
  outletId,
  status: 'ACTIVE',
  ...changes,
});
export const teamOutlets: Outlet[] = [
  { ...dates, id: rid(2), restaurantId: rid(1), name: 'Agla', isActive: true },
  { ...dates, id: rid(3), restaurantId: rid(1), name: 'Fidjrossè', isActive: true },
  { ...dates, id: rid(4), restaurantId: rid(1), name: 'Calavi', isActive: false },
];
