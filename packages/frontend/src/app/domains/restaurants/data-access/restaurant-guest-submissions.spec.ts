import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { RestaurantGuestSubmissions } from './restaurant-guest-submissions';
import { RestaurantGuestCartStore } from './restaurant-guest-cart.store';
import { RestaurantGuestApi } from './restaurant-guest.api';
import type { GuestContextResponse } from '@liass-ohada/shared/restaurants';
const context = {
  state: 'OCCUPIED',
  policy: 'STAFF_APPROVAL',
  orderingPermitted: true,
  visitRef: 'v'.repeat(43),
  guestHandle: 'g'.repeat(22),
  capability: 'c'.repeat(100),
  restaurantName: 'Bistro',
  outletName: 'Centre',
  tableName: 'Jardin',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  waiterCallAvailable: true,
} as const;
const item = {
  reference: 'r'.repeat(43),
  selectionRef: 's'.repeat(200),
  name: 'Poulet',
  amountMinor: 2500,
  availability: 'AVAILABLE' as const,
};
describe('Guest submissions', () => {
  let client: QueryClient;
  let store: RestaurantGuestCartStore;
  let workflow: RestaurantGuestSubmissions;
  const api = { submissions: vi.fn(), submissionState: vi.fn() };
  beforeEach(() => {
    sessionStorage.clear();
    client = new QueryClient();
    api.submissions.mockReset();
    api.submissionState.mockResolvedValue({ state: 'READY', requests: [] });
    TestBed.configureTestingModule({
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantGuestApi, useValue: api },
      ],
    });
    store = TestBed.inject(RestaurantGuestCartStore);
    store.activate('liass-restaurants.guest.' + 'a'.repeat(64), context);
    store.add(item, 'XOF', new Date(Date.now() + 900000).toISOString());
    workflow = TestBed.inject(RestaurantGuestSubmissions);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it.each(['FREE', 'DISABLED', 'DIRECT'])('blocks %s submission', (state) => {
    store.activate('liass-restaurants.guest.' + 'a'.repeat(64), {
      ...context,
      ...(state === 'FREE' ? { state: 'FREE', visitRef: null } : { policy: state }),
    } as GuestContextResponse & typeof context);
    expect(workflow.canSend()).toBe(false);
    workflow.submit();
    expect(api.submissions).not.toHaveBeenCalled();
  });
  it('retains intent on uncertainty and retries exact durable idempotency key', async () => {
    api.submissions.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      state: 'CONFIRMED',
      request: { requestId: 'request', state: 'PENDING_APPROVAL', lines: [] },
    });
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isError()).toBe(true);
    });
    expect(store.lines()).toHaveLength(1);
    const body = api.submissions.mock.calls[0][1];
    expect(
      sessionStorage.getItem('liass-restaurants.guest.' + 'a'.repeat(64) + '.submission.v1'),
    ).toContain(body.clientRequestId);
    workflow.submit();
    await vi.waitFor(() => expect(workflow.send.isSuccess()).toBe(true));
    expect(api.submissions.mock.calls[1][1]).toEqual(body);
    expect(store.lines()).toHaveLength(0);
    expect(
      sessionStorage.getItem('liass-restaurants.guest.' + 'a'.repeat(64) + '.submission.v1'),
    ).toBeNull();
  });
  it('does not erase later Cart edits after durable confirmation', async () => {
    let finish!: (v: unknown) => void;
    api.submissions.mockImplementation(() => new Promise((r) => (finish = r)));
    workflow.submit();
    workflow.submit();
    await vi.waitFor(() => expect(api.submissions).toHaveBeenCalledTimes(1));
    store.setQuantity(item.reference, 3);
    finish({
      state: 'CONFIRMED',
      request: { requestId: 'request', state: 'PENDING_APPROVAL', lines: [] },
    });
    await vi.waitFor(() => expect(workflow.send.isSuccess()).toBe(true));
    expect(store.lines()[0].quantity).toBe(3);
  });
  it('visit changes do not reuse an uncertain command', async () => {
    api.submissions.mockRejectedValue(new Error());
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isError()).toBe(true);
    });
    store.activate('liass-restaurants.guest.' + 'a'.repeat(64), {
      ...context,
      visitRef: 'b'.repeat(43),
    });
    expect(workflow.canSend()).toBe(false);
    workflow.submit();
    expect(api.submissions).toHaveBeenCalledTimes(1);
  });
});
