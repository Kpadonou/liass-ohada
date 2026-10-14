import type { RestaurantServiceFloorResponse } from '@liass-ohada/shared/restaurants';
import { rid } from './restaurants.test-fixture';
export const floorFixture = (): RestaurantServiceFloorResponse => ({
  outletId: rid(2),
  items: [
    {
      tableId: rid(4),
      code: 'T01',
      areaId: rid(3),
      areaName: 'Main Room',
      state: 'FREE',
      capacity: 4,
    },
    {
      tableId: rid(5),
      code: 'T02',
      areaId: rid(3),
      areaName: 'Main Room',
      state: 'OCCUPIED',
      capacity: 4,
      guestSessionId: rid(9),
      openedAt: '2026-10-14T10:00:00.000Z',
      openedBy: 'private-actor',
      currentAmountMinor: 12500,
      currency: 'XOF',
    },
    { tableId: rid(6), code: 'T03', areaId: rid(7), areaName: 'Terrace', state: 'FREE' },
  ],
});
