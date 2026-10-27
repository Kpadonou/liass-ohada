import { StockItemResponseData, StockMovementResponseData } from '@liass-ohada/shared/restaurants';
import { InventoryContext } from './restaurant-inventory.api';
import { rid } from './restaurants.test-fixture';
export const inventoryContext: InventoryContext = {
  org: 'org',
  user: 'owner',
  revision: 1,
  outlet: rid(2),
  identity: 'context-1',
};
export const stockItem = (patch: Partial<StockItemResponseData> = {}): StockItemResponseData => ({
  id: rid(80),
  name: 'Bottled water',
  unit: 'BOTTLE',
  isActive: true,
  balanceMilli: 12000,
  isNegativeStock: false,
  version: 1,
  createdAt: '2026-10-27T10:00:00.000Z',
  updatedAt: '2026-10-27T10:00:00.000Z',
  ...patch,
});
export const stockMovement = (
  patch: Partial<StockMovementResponseData> = {},
): StockMovementResponseData => ({
  id: rid(81),
  stockItemId: rid(80),
  type: 'RECEIPT',
  deltaMilli: 12000,
  resultingBalanceMilli: 12000,
  isNegativeStock: false,
  actorId: 'owner',
  source: 'MANUAL',
  createdAt: '2026-10-27T10:00:00.000Z',
  ...patch,
});
