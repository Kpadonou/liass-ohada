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
  it('blocks an empty Cart even when the FREE DIRECT context is eligible', () => {
    store.discard();
    store.activate('liass-restaurants.guest.' + 'a'.repeat(64), {
      ...context,
      state: 'FREE',
      visitRef: null,
      policy: 'DIRECT',
    });
    expect(workflow.canSend()).toBe(false);
    workflow.submit();
    expect(api.submissions).not.toHaveBeenCalled();
  });
  it.each(['DISABLED'])('blocks %s submission', (state) => {
    store.activate('liass-restaurants.guest.' + 'a'.repeat(64), {
      ...context,
      ...(state === 'FREE' ? { state: 'FREE', visitRef: null } : { policy: state }),
    } as GuestContextResponse & typeof context);
    expect(workflow.canSend()).toBe(false);
    workflow.submit();
    expect(api.submissions).not.toHaveBeenCalled();
  });
  it.each(['DIRECT', 'STAFF_APPROVAL'] as const)(
    'FREE %s can submit and clears Cart only after durable confirmation',
    async (policy) => {
      store.activate('liass-restaurants.guest.' + 'b'.repeat(64), {
        ...context,
        state: 'FREE',
        visitRef: null,
        policy,
      });
      store.add(item, 'XOF', new Date(Date.now() + 900000).toISOString());
      api.submissions.mockResolvedValue({
        state: 'CONFIRMED',
        request: { requestId: 'pending', state: 'PENDING_SERVICE', mode: policy, lines: [] },
      });
      TestBed.tick();
      expect(workflow.canSend()).toBe(true);
      workflow.submit();
      await vi.waitFor(() => {
        TestBed.tick();
        expect(workflow.send.isSuccess()).toBe(true);
      });
      expect(api.submissions).toHaveBeenCalledTimes(1);
      expect(store.lines()).toHaveLength(0);
    },
  );
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

describe('DIRECT Guest submission workflow', () => {
  let client: QueryClient;
  let store: RestaurantGuestCartStore;
  let workflow: RestaurantGuestSubmissions;
  const api = { submissions: vi.fn(), submissionState: vi.fn() };
  const scope = 'liass-restaurants.guest.' + 'a'.repeat(64);
  beforeEach(() => {
    sessionStorage.clear();
    client = new QueryClient();
    api.submissions.mockReset();
    api.submissionState.mockReset().mockResolvedValue({ state: 'READY', requests: [] });
    TestBed.configureTestingModule({
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantGuestApi, useValue: api },
      ],
    });
    store = TestBed.inject(RestaurantGuestCartStore);
    store.activate(scope, { ...context, policy: 'DIRECT' });
    store.add(item, 'XOF', new Date(Date.now() + 900000).toISOString());
    workflow = TestBed.inject(RestaurantGuestSubmissions);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  it('enables DIRECT and clears only after durable ACCEPTED confirmation', async () => {
    expect(workflow.canSend()).toBe(true);
    let finish!: (v: unknown) => void;
    api.submissions.mockImplementation(() => new Promise((r) => (finish = r)));
    workflow.submit();
    await vi.waitFor(() => expect(api.submissions).toHaveBeenCalledTimes(1));
    expect(store.lines()).toHaveLength(1);
    finish({
      state: 'CONFIRMED',
      request: {
        requestId: 'direct',
        mode: 'DIRECT',
        state: 'ACCEPTED',
        orderStatus: 'CONFIRMED',
        lines: [],
      },
    });
    await vi.waitFor(() => {
      TestBed.tick();
      expect(store.lines()).toHaveLength(0);
    });
  });
  it('keeps staged DIRECT intent and retries exactly the same command after uncertainty', async () => {
    api.submissions.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
      state: 'CONFIRMED',
      request: {
        requestId: 'direct',
        mode: 'DIRECT',
        state: 'ACCEPTED',
        orderStatus: 'PREPARING',
        lines: [],
      },
    });
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isError()).toBe(true);
    });
    const body = api.submissions.mock.calls[0][1];
    expect(store.lines()).toHaveLength(1);
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isSuccess()).toBe(true);
    });
    expect(api.submissions.mock.calls[1][1]).toEqual(body);
    expect(store.lines()).toHaveLength(0);
  });
  it('does not clear Cart for a technical PROCESSING result', async () => {
    api.submissions.mockResolvedValue({
      state: 'CONFIRMED',
      request: { requestId: 'direct', mode: 'DIRECT', state: 'PROCESSING', lines: [] },
    });
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isSuccess()).toBe(true);
    });
    expect(store.lines()).toHaveLength(1);
    expect(workflow.hasUncertain()).toBe(true);
  });
  it('reconciles durable own-status after reload even if sending policy is now disabled', async () => {
    api.submissions.mockRejectedValue(new Error('lost response'));
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isError()).toBe(true);
    });
    const body = api.submissions.mock.calls[0][1];
    TestBed.resetTestingModule();
    client.clear();
    client = new QueryClient();
    api.submissionState.mockResolvedValue({
      state: 'READY',
      requests: [
        {
          requestId: 'direct',
          mode: 'DIRECT',
          clientRequestId: body.clientRequestId,
          state: 'ACCEPTED',
          orderStatus: 'CONFIRMED',
          lines: [],
        },
      ],
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantGuestApi, useValue: api },
      ],
    });
    store = TestBed.inject(RestaurantGuestCartStore);
    store.activate(scope, { ...context, policy: 'DISABLED' });
    workflow = TestBed.inject(RestaurantGuestSubmissions);
    await vi.waitFor(() => {
      TestBed.tick();
      expect(store.lines()).toHaveLength(0);
    });
    expect(api.submissions).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(scope + '.submission.v1')).toBeNull();
  });
  it('reconciles an uncertain FREE submission after the same phone enters its opened service', async () => {
    const scope = 'liass-restaurants.guest.' + 'b'.repeat(64);
    store.activate(scope, { ...context, state: 'FREE', visitRef: null });
    store.add(item, 'XOF', new Date(Date.now() + 900000).toISOString());
    TestBed.tick();
    api.submissions.mockRejectedValueOnce(new Error('uncertain response'));
    workflow.submit();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(workflow.send.isError()).toBe(true);
    });
    const body = api.submissions.mock.calls[0][1];
    expect(store.lines()).toHaveLength(1);
    api.submissionState.mockResolvedValue({
      state: 'READY',
      requests: [
        { requestId: 'bound', clientRequestId: body.clientRequestId, state: 'PENDING_APPROVAL' },
      ],
    });
    store.activate(scope, context);
    expect(workflow.hasUncertain()).toBe(true);
    TestBed.tick();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(store.lines()).toHaveLength(0);
    });
    expect(api.submissions).toHaveBeenCalledTimes(1);
  });
});
