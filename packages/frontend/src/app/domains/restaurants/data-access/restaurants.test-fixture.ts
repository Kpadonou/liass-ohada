import { RestaurantKind, RestaurantEntity } from './restaurants-model';
export const rid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const context = { outletId: rid(2), areaId: rid(3), categoryId: rid(6) };
export const metadata = {
  id: rid(1),
  name: 'Héritage Bistro',
  version: 1,
  isActive: true,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};
export function row(kind: RestaurantKind): RestaurantEntity {
  switch (kind) {
    case 'restaurant':
      return { ...metadata, guestOrderingPolicy: 'STAFF_APPROVAL' };
    case 'outlet':
      return { ...metadata, id: rid(2), name: 'Agla', restaurantId: rid(1) };
    case 'area':
      return { ...metadata, id: rid(3), name: 'Main Room', outletId: rid(2) };
    case 'table':
      return {
        ...metadata,
        id: rid(4),
        name: 'Table 1',
        outletId: rid(2),
        serviceAreaId: rid(3),
        code: 'T01',
      };
    case 'station':
      return { ...metadata, id: rid(5), name: 'BAR', outletId: rid(2) };
    case 'menu':
      return { ...metadata, id: rid(7), name: 'Agla Menu', outletId: rid(2), currency: 'XOF' };
    case 'category':
      return { ...metadata, id: rid(6), name: 'Drinks', outletId: rid(2), menuId: rid(7) };
    case 'item':
      return {
        ...metadata,
        id: rid(8),
        name: 'Beer',
        outletId: rid(2),
        categoryId: rid(6),
        menuId: rid(7),
        price: { amountMinor: 1000, currency: 'XOF' },
        availability: 'AVAILABLE',
        preparationStationId: rid(5),
        guestReorderEnabled: true,
      };
  }
}
