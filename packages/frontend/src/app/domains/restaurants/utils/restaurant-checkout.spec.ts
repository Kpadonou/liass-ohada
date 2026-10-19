import { checkoutAllocationProposal, checkoutClosureBlockers } from './restaurant-checkout';
import type { RestaurantOrder, GuestSessionRead } from '@liass-ohada/shared/restaurants';
const order = (id: number, overrides: Partial<RestaurantOrder> = {}): RestaurantOrder =>
  ({
    orderId: String(id).padStart(3, '0'),
    createdAt: '2026-10-19T10:00:00Z',
    status: 'SUBMITTED',
    dueMinor: 5000,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
    draftLineCount: 0,
    acceptedLineCount: 1,
    outstandingWorkCount: 0,
    ...overrides,
  }) as RestaurantOrder;
const session = (overrides: Partial<GuestSessionRead> = {}): GuestSessionRead =>
  ({
    orderCount: 1,
    dueMinor: 5000,
    paidMinor: 5000,
    reservedMinor: 0,
    pendingPaymentCount: 0,
    ...overrides,
  }) as GuestSessionRead;
describe('Cashier proposals and closure signals', () => {
  it('uses stable creation/identity order regardless of loaded array order', () => {
    expect(checkoutAllocationProposal([order(2), order(1)], 8000)).toEqual([
      { orderId: '001', amountMinor: 5000 },
      { orderId: '002', amountMinor: 3000 },
    ]);
  });
  it('uses available capacity, skipping terminal and draft Orders', () => {
    expect(
      checkoutAllocationProposal(
        [
          order(1, { status: 'CLOSED' }),
          order(2, { status: 'DRAFT' }),
          order(3, { paidMinor: 1000, reservedMinor: 2000 }),
        ],
        2000,
      ),
    ).toEqual([{ orderId: '003', amountMinor: 2000 }]);
  });
  it('rejects proposals requiring an eleventh allocation without splitting payment', () => {
    expect(() =>
      checkoutAllocationProposal(
        Array.from({ length: 11 }, (_, i) => order(i)),
        50001,
      ),
    ).toThrow();
    expect(
      checkoutAllocationProposal(
        Array.from({ length: 11 }, (_, i) => order(i)),
        50000,
      ),
    ).toHaveLength(10);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
    'rejects unsafe applied amount %s',
    (value) => expect(() => checkoutAllocationProposal([order(1)], value)).toThrow(),
  );
  it('does not mistake fully paid READY work or unresolved drafts for close eligibility', () => {
    expect(
      checkoutClosureBlockers(
        session(),
        [order(1, { paidMinor: 5000, outstandingWorkCount: 1, draftLineCount: 1 })],
        true,
      ),
    ).toEqual(['DRAFT', 'WORK']);
  });
  it('blocks never-accepted drafts even with no remaining draft lines', () => {
    expect(
      checkoutClosureBlockers(
        session(),
        [order(1, { status: 'DRAFT', acceptedLineCount: 0, paidMinor: 5000 })],
        true,
      ),
    ).toContain('UNACCEPTED');
  });
  it('requires complete enumeration and payment/reservation guards', () => {
    expect(
      checkoutClosureBlockers(
        session({ reservedMinor: 1, pendingPaymentCount: 1, paidMinor: 0 }),
        [],
        false,
      ),
    ).toEqual(['INCOMPLETE', 'UNPAID', 'PENDING']);
  });
  it('permits zero-value accepted no-station work and skips terminal Orders', () => {
    expect(
      checkoutClosureBlockers(
        session({ dueMinor: 0, paidMinor: 0 }),
        [order(1, { dueMinor: 0 })],
        true,
      ),
    ).toEqual([]);
  });
});
