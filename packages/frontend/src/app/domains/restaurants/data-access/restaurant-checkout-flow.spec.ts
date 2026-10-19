import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  RestaurantOrder,
  GuestSessionRead,
  CaptureRestaurantPaymentRequest,
} from '@liass-ohada/shared/restaurants';
import { RestaurantCheckoutFlow } from './restaurant-checkout-flow';
import { RestaurantCheckoutApi } from './restaurant-checkout.api';
import { RestaurantOrdersApi } from './restaurant-orders.api';
import { RestaurantsApi } from './restaurants.api';
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: 'outlet', session: 'session' };
const row = (id: string) => ({ orderId: id, version: 1, status: 'SUBMITTED' }) as RestaurantOrder;
const visit = {
  version: 4,
  status: 'OPEN',
  openOrderCount: 0,
  dueMinor: 20000,
  paidMinor: 20000,
  reservedMinor: 0,
  pendingPaymentCount: 0,
} as GuestSessionRead;
describe('Resumable canonical checkout commands', () => {
  const api = { capture: vi.fn(), closeOrder: vi.fn(), closeSession: vi.fn() };
  const orders = { assertContext: vi.fn(), order: vi.fn() };
  const sessions = { guestSession: vi.fn() };
  let flow: RestaurantCheckoutFlow;
  beforeEach(() => {
    vi.resetAllMocks();
    orders.order.mockImplementation((_ctx, id) => Promise.resolve(row(id)));
    sessions.guestSession.mockResolvedValue(visit);
    api.closeOrder.mockResolvedValue({ status: 'CLOSED' });
    api.closeSession.mockResolvedValue({ ...visit, status: 'CLOSED' });
    TestBed.configureTestingModule({
      providers: [
        { provide: RestaurantCheckoutApi, useValue: api },
        { provide: RestaurantOrdersApi, useValue: orders },
        { provide: RestaurantsApi, useValue: sessions },
      ],
    });
    flow = TestBed.inject(RestaurantCheckoutFlow);
  });
  afterEach(() => TestBed.resetTestingModule());
  it('closes sequentially, skips terminal rows, obtains fresh final session version', async () => {
    const progress = vi.fn();
    await flow.close(ctx, [row('a'), { ...row('closed'), status: 'CLOSED' }, row('b')], progress);
    expect(orders.order.mock.calls.map((call) => call[1])).toEqual(['a', 'b']);
    expect(api.closeOrder).toHaveBeenCalledTimes(2);
    expect(api.closeSession.mock.calls[0][1].expectedVersion).toBe(4);
    expect(api.closeOrder.mock.invocationCallOrder[1]).toBeLessThan(
      sessions.guestSession.mock.invocationCallOrder[0],
    );
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });
  it('preserves durable partial progress and retries ambiguous Order close identically', async () => {
    api.closeOrder
      .mockResolvedValueOnce({ status: 'CLOSED' })
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await expect(flow.close(ctx, [row('a'), row('b')], vi.fn())).rejects.toBeDefined();
    expect(api.closeSession).not.toHaveBeenCalled();
    const original = api.closeOrder.mock.calls[1][2];
    await flow.close(ctx, [{ ...row('a'), status: 'CLOSED' }, row('b')], vi.fn());
    expect(api.closeOrder.mock.calls[2][2]).toEqual(original);
  });
  it('retries lost final response before OPEN-only reads', async () => {
    api.closeSession.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await expect(flow.close(ctx, [], vi.fn())).rejects.toBeDefined();
    const original = api.closeSession.mock.calls[0][1];
    sessions.guestSession.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
    await flow.close(ctx, [], vi.fn());
    expect(api.closeSession.mock.calls[1][1]).toEqual(original);
    expect(sessions.guestSession).toHaveBeenCalledTimes(1);
  });
  it('does not release table while canonical session has open Orders or debt', async () => {
    sessions.guestSession.mockResolvedValue({ ...visit, openOrderCount: 1 });
    await expect(flow.close(ctx, [], vi.fn())).rejects.toBeDefined();
    expect(api.closeSession).not.toHaveBeenCalled();
  });
  it('stops before commands after tenant/account context invalidation', async () => {
    orders.assertContext.mockImplementation(() => {
      throw new Error('Changed');
    });
    await expect(flow.close(ctx, [row('a')], vi.fn())).rejects.toBeDefined();
    expect(api.closeOrder).not.toHaveBeenCalled();
  });
  const payment = {
    clientRequestId: '00000000-0000-4000-8000-000000000088',
    expectedVersion: 1,
    method: 'CASH',
    currency: 'XOF',
    allocations: [{ orderId: '00000000-0000-4000-8000-000000000100', amountMinor: 8000 }],
    cashTenderedMinor: 10000,
  } as CaptureRestaurantPaymentRequest;
  it('retains exact payment intent on ambiguous failure, prevents redistribution', async () => {
    api.capture
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }))
      .mockResolvedValue({ appliedAmountMinor: 8000 });
    await expect(flow.capture(ctx, payment)).rejects.toBeDefined();
    await expect(flow.capture(ctx, { ...payment, cashTenderedMinor: 11000 })).rejects.toThrow(
      'Unresolved',
    );
    await flow.capture(ctx, payment);
    expect(api.capture).toHaveBeenCalledTimes(2);
    expect(api.capture.mock.calls[1][1]).toEqual(payment);
    expect(flow.pendingPayment(ctx)).toBeUndefined();
  });
  it('does not retry definite financial conflict, allowing explicit fresh proposal', async () => {
    api.capture.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await expect(flow.capture(ctx, payment)).rejects.toBeDefined();
    expect(flow.pendingPayment(ctx)).toBeUndefined();
    expect(api.capture).toHaveBeenCalledTimes(1);
  });
  it('blocks duplicate concurrent clicks without a second request', async () => {
    let resolve!: (value: unknown) => void;
    api.capture.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = flow.capture(ctx, payment);
    await expect(flow.capture(ctx, payment)).rejects.toThrow('pending');
    resolve({});
    await pending;
    expect(api.capture).toHaveBeenCalledTimes(1);
  });
});
