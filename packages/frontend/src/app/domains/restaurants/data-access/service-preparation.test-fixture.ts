import { PreparationReadSchema } from '@liass-ohada/shared/restaurants';
import { rid } from './restaurants.test-fixture';
export const serviceTask = (
  fire = 22,
  state: 'READY' | 'QUEUED' | 'IN_PROGRESS' | 'SERVED' = 'READY',
) =>
  PreparationReadSchema.parse({
    orgId: 'org',
    outletId: rid(2),
    schemaVersion: 1,
    orderId: rid(20),
    itemId: rid(21),
    fireId: rid(fire),
    submissionId: rid(fire + 100),
    stationId: rid(3),
    stationVersion: 1,
    generation: 1,
    name: 'Poulet braisé sauce maison',
    quantity: 2,
    notes: 'Sans piment',
    state,
    queuedAt: '2026-10-18T10:00:00.000Z',
    queuedBy: 'cook',
    version: 3,
    ...(state !== 'QUEUED' ? { startedAt: '2026-10-18T10:01:00.000Z', startedBy: 'cook' } : {}),
    ...(['READY', 'SERVED'].includes(state)
      ? { readyAt: '2026-10-18T10:02:00.000Z', readyBy: 'cook' }
      : {}),
    ...(state === 'SERVED' ? { servedAt: '2026-10-18T10:03:00.000Z', servedBy: 'waiter' } : {}),
    serviceContext: { mode: 'DINE_IN', tableName: 'Terrasse jardin' },
  });
export const serviceContext = {
  org: 'org',
  user: 'waiter',
  revision: 1,
  outlet: rid(2),
  session: rid(9),
};
