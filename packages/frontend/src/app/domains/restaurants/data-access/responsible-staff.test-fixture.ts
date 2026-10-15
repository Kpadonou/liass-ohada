import { GuestSessionReadSchema, type GuestSessionRead } from '@liass-ohada/shared/restaurants';
import { rid } from './restaurants.test-fixture';
export const sessionFixture = (changes: Partial<GuestSessionRead> = {}): GuestSessionRead =>
  GuestSessionReadSchema.parse({
    orgId: 'org',
    outletId: rid(2),
    schemaVersion: 1,
    guestSessionId: rid(9),
    tableId: rid(5),
    areaId: rid(3),
    tableCode: 'T02',
    tableName: 'Table T02',
    currency: 'XOF',
    status: 'OPEN',
    openedAt: '2026-10-15T10:00:00.000Z',
    openedBy: 'private-opener',
    version: 7,
    financialRevision: 0,
    orderCount: 0,
    openOrderCount: 0,
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
    ...changes,
  });
