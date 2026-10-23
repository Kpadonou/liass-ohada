import { TestBed } from '@angular/core/testing';
import { GuestCarte } from '@liass-ohada/shared/restaurants';
import { RestaurantGuestCartStore } from './restaurant-guest-cart.store';

const scopeA = `liass-restaurants.guest.${'a'.repeat(64)}`;
const scopeB = `liass-restaurants.guest.${'b'.repeat(64)}`;
const expiresAt = new Date(Date.now() + 900_000).toISOString();
const free = (handle = 'g'.repeat(22)) =>
  ({ state: 'FREE', visitRef: null, guestHandle: handle }) as never;
const occupied = (visitRef = 'v'.repeat(43), handle = 'g'.repeat(22)) =>
  ({ state: 'OCCUPIED', visitRef, guestHandle: handle }) as never;
type CarteItem = GuestCarte['categories'][number]['items'][number];
const item = (
  reference: string,
  amountMinor = 2500,
  availability: CarteItem['availability'] = 'AVAILABLE',
): CarteItem => ({
  reference,
  selectionRef: `selection-${reference}`.padEnd(20, 'x'),
  name: `Item ${reference}`,
  amountMinor,
  availability,
});

describe('RestaurantGuestCartStore', () => {
  let store: RestaurantGuestCartStore;
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(RestaurantGuestCartStore);
    store.activate(scopeA, free());
  });

  it('adds AVAILABLE items, merges repeated adds, totals and removes locally', () => {
    expect(store.add(item('reference-one'), 'XOF', expiresAt)).toBe('OK');
    expect(store.add(item('reference-one'), 'XOF', expiresAt)).toBe('OK');
    expect(store.totalUnits()).toBe(2);
    expect(store.totalAmountMinor()).toBe(5000);
    expect(store.lines()).toHaveLength(1);
    store.remove('reference-one');
    expect(store.lines()).toEqual([]);
  });

  it('rejects unavailable items and enforces quantity, line and total limits', () => {
    expect(store.add(item('unavailable-item', 100, 'UNAVAILABLE'), 'XOF', expiresAt)).toBe(
      'REVIEW_REQUIRED',
    );
    store.add(item('reference-one'), 'XOF', expiresAt);
    expect(store.setQuantity('reference-one', 0)).toBe('INVALID_QUANTITY');
    expect(store.setQuantity('reference-one', 21)).toBe('LINE_QUANTITY_LIMIT');
    for (let index = 2; index <= 12; index++) {
      store.add(item(`reference-${index}`), 'XOF', expiresAt);
    }
    expect(store.add(item('reference-thirteen'), 'XOF', expiresAt)).toBe('LINE_LIMIT');
    for (let index = 1; index <= 4; index++)
      expect(store.setQuantity(`reference-${index === 1 ? 'one' : index}`, 20)).toBe('OK');
    expect(store.setQuantity('reference-5', 13)).toBe('OK');
    expect(store.totalUnits()).toBe(100);
    expect(store.setQuantity('reference-12', 2)).toBe('TOTAL_QUANTITY_LIMIT');
  });

  it('persists notes and quantities in sessionStorage and enforces note length', () => {
    store.add(item('reference-one'), 'XOF', expiresAt);
    expect(store.setQuantity('reference-one', 4)).toBe('OK');
    expect(store.setNote('reference-one', 'Sans piment')).toBe('OK');
    expect(store.setNote('reference-one', 'x'.repeat(251))).toBe('NOTE_LIMIT');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    store = TestBed.inject(RestaurantGuestCartStore);
    store.activate(scopeA, free('another-browser-handle'));
    expect(store.lines()[0]).toMatchObject({ quantity: 4, note: 'Sans piment' });
  });

  it('isolates carts by non-sensitive table scope', () => {
    store.add(item('reference-one'), 'XOF', expiresAt);
    store.activate(scopeB, free());
    expect(store.lines()).toEqual([]);
    store.activate(scopeA, free());
    expect(store.lines()).toHaveLength(1);
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    );
    expect(keys.join(' ')).not.toContain('tableId');
  });

  it('binds FREE intent once to the first visit and preserves it across handle renewal', () => {
    store.add(item('reference-one'), 'XOF', expiresAt);
    store.activate(scopeA, occupied('A'.repeat(43)));
    expect(store.cart()).toMatchObject({ scope: 'VISIT', visitRef: 'A'.repeat(43) });
    store.activate(scopeA, occupied('A'.repeat(43), 'new-handle'.repeat(3)));
    expect(store.contextStatus()).toBe('ACTIVE_VISIT');
    expect(store.lines()).toHaveLength(1);
  });

  it('never migrates a visit cart to another visit and keeps ended intent visible', () => {
    store.add(item('reference-one'), 'XOF', expiresAt);
    store.activate(scopeA, occupied('A'.repeat(43)));
    store.activate(scopeA, occupied('B'.repeat(43)));
    expect(store.contextStatus()).toBe('DIFFERENT_VISIT');
    expect(store.add(item('reference-two'), 'XOF', expiresAt)).toBe('CONTEXT_BLOCKED');
    expect(store.cart()?.visitRef).toBe('A'.repeat(43));
    store.markVisitEnded();
    expect(store.contextStatus()).toBe('VISIT_ENDED');
    expect(store.lines()).toHaveLength(1);
  });

  it('rebinds an expired selection reference by public reference without losing intent', () => {
    store.add(item('reference-one'), 'XOF', new Date(0).toISOString());
    store.setQuantity('reference-one', 3);
    store.setNote('reference-one', 'No ice');
    store.reconcile(
      [{ ...item('reference-one'), selectionRef: 'fresh-selection-reference' }],
      'XOF',
      expiresAt,
    );
    expect(store.lines()[0]).toMatchObject({
      selectionRef: 'fresh-selection-reference',
      selectionExpiresAt: expiresAt,
      quantity: 3,
      note: 'No ice',
      status: 'READY',
    });
  });

  it('requires price confirmation and retains unavailable or missing lines', () => {
    store.add(item('reference-one'), 'XOF', expiresAt);
    store.reconcile([item('reference-one', 2750)], 'XOF', expiresAt);
    expect(store.lines()[0]).toMatchObject({ status: 'PRICE_CHANGED', presentedAmountMinor: 2500 });
    store.acceptPrice('reference-one');
    expect(store.lines()[0]).toMatchObject({ status: 'READY', presentedAmountMinor: 2750 });
    store.reconcile([item('reference-one', 2750, 'UNAVAILABLE')], 'XOF', expiresAt);
    expect(store.lines()[0].status).toBe('UNAVAILABLE');
    store.reconcile([], 'XOF', expiresAt);
    expect(store.lines()[0].status).toBe('MISSING');
  });

  it('keeps local actions functional when canonical context is temporarily unavailable', () => {
    store.add(item('reference-one'), 'XOF', expiresAt);
    store.activate(scopeA, null);
    expect(store.contextStatus()).toBe('CONTEXT_UNAVAILABLE');
    expect(store.setQuantity('reference-one', 2)).toBe('OK');
    expect(store.setNote('reference-one', 'Offline note')).toBe('OK');
  });
});
