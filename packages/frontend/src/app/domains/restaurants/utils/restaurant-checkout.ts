import type { RestaurantOrder, GuestSessionRead } from '@liass-ohada/shared/restaurants';

/** A proposal only: the server revalidates every allocation atomically. */
export function checkoutAllocationProposal(orders: readonly RestaurantOrder[], amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid amount');
  let remaining = amount;
  const allocations: { orderId: string; amountMinor: number }[] = [];
  const sorted = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt
      ? -1
      : a.createdAt > b.createdAt
        ? 1
        : a.orderId.localeCompare(b.orderId),
  );
  for (const order of sorted) {
    if (order.status !== 'SUBMITTED') continue;
    const capacity = order.dueMinor - order.paidMinor - order.reservedMinor;
    if (capacity <= 0) continue;
    if (allocations.length === 10) break;
    const applied = Math.min(capacity, remaining);
    allocations.push({ orderId: order.orderId, amountMinor: applied });
    remaining -= applied;
    if (!remaining) return allocations;
  }
  throw new Error('Allocation capacity exceeded');
}

export type CheckoutBlocker =
  | 'UNPAID'
  | 'PENDING'
  | 'DRAFT'
  | 'WORK'
  | 'UNACCEPTED'
  | 'INCOMPLETE'
  | 'CLOSED';
export function checkoutClosureBlockers(
  session: GuestSessionRead,
  orders: readonly RestaurantOrder[],
  complete: boolean,
): CheckoutBlocker[] {
  const blockers = new Set<CheckoutBlocker>();
  if (session.status === 'CLOSED') blockers.add('CLOSED');
  if (!complete || orders.length !== session.orderCount) blockers.add('INCOMPLETE');
  if (session.dueMinor !== session.paidMinor) blockers.add('UNPAID');
  if (session.reservedMinor || session.pendingPaymentCount) blockers.add('PENDING');
  for (const order of orders) {
    if (order.status === 'CLOSED' || order.status === 'CANCELLED') continue;
    if (order.draftLineCount) blockers.add('DRAFT');
    if (order.status !== 'SUBMITTED' || !order.acceptedLineCount) blockers.add('UNACCEPTED');
    if (order.outstandingWorkCount) blockers.add('WORK');
    if (order.dueMinor !== order.paidMinor) blockers.add('UNPAID');
    if (order.reservedMinor || order.pendingPaymentCount) blockers.add('PENDING');
  }
  return [...blockers];
}
