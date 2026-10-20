import { TestBed } from '@angular/core/testing';
import { RestaurantReceiptFlow } from './restaurant-receipt-flow';
import { RestaurantReceiptApi } from './restaurant-receipt.api';
import { receiptSummary } from './restaurant-receipt.test-fixture';
import { rid } from './restaurants.test-fixture';
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
describe('Receipt foreground continuation', () => {
  const api = { publish: vi.fn(), assertContext: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: RestaurantReceiptApi, useValue: api }],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('one-call FINAL and sequential BUILDING reuse exact intent without invalidation', async () => {
    let concurrent = 0,
      max = 0;
    api.publish.mockImplementation(async () => {
      max = Math.max(max, ++concurrent);
      await Promise.resolve();
      concurrent--;
      return api.publish.mock.calls.length < 3
        ? {
            state: 'BUILDING',
            receiptId: rid(50),
            version: api.publish.mock.calls.length,
            partCount: 2,
          }
        : { state: 'FINAL', receipt: receiptSummary() };
    });
    const flow = TestBed.inject(RestaurantReceiptFlow);
    expect(await flow.resume(ctx, () => true, vi.fn())).toBe(true);
    expect(max).toBe(1);
    expect(new Set(api.publish.mock.calls.map((args) => args[1])).size).toBe(1);
  });
  it('lost response retains identity for durable FINAL replay', async () => {
    const flow = TestBed.inject(RestaurantReceiptFlow);
    api.publish
      .mockRejectedValueOnce(new Error('ambiguous'))
      .mockResolvedValue({ state: 'FINAL', receipt: receiptSummary() });
    await expect(flow.resume(ctx, () => true, vi.fn())).rejects.toThrow();
    expect(await flow.resume(ctx, () => true, vi.fn())).toBe(true);
    expect(api.publish.mock.calls[0]).toEqual(api.publish.mock.calls[1]);
  });
  it('stalled progress stops after three requests and manual resume keeps identity', async () => {
    api.publish.mockResolvedValue({
      state: 'BUILDING',
      receiptId: rid(50),
      version: 1,
      partCount: 1,
    });
    const flow = TestBed.inject(RestaurantReceiptFlow);
    expect(await flow.resume(ctx, () => true, vi.fn())).toBe(false);
    expect(api.publish).toHaveBeenCalledTimes(3);
    api.publish.mockResolvedValue({ state: 'FINAL', receipt: receiptSummary() });
    expect(await flow.resume(ctx, () => true, vi.fn())).toBe(true);
    expect(api.publish.mock.calls[0][1]).toBe(api.publish.mock.calls[3][1]);
  });
  it('bounds healthy continuation to twelve calls and stops on navigation/context change', async () => {
    let active = true;
    api.publish.mockImplementation(async () => ({
      state: 'BUILDING',
      receiptId: rid(50),
      version: api.publish.mock.calls.length,
      partCount: api.publish.mock.calls.length,
    }));
    const flow = TestBed.inject(RestaurantReceiptFlow);
    expect(await flow.resume(ctx, () => true, vi.fn())).toBe(false);
    expect(api.publish).toHaveBeenCalledTimes(12);
    api.publish.mockImplementation(async () => {
      active = false;
      return { state: 'FINAL', receipt: receiptSummary() };
    });
    expect(await flow.resume(ctx, () => active, vi.fn())).toBe(false);
  });
  it('new application flow may use a new identity; server owns the existing reserved receipt', async () => {
    api.publish.mockResolvedValue({ state: 'FINAL', receipt: receiptSummary() });
    await TestBed.inject(RestaurantReceiptFlow).resume(ctx, () => true, vi.fn());
    const first = api.publish.mock.calls[0][1];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: RestaurantReceiptApi, useValue: api }],
    });
    await TestBed.inject(RestaurantReceiptFlow).resume(ctx, () => true, vi.fn());
    expect(api.publish.mock.calls[1][1]).not.toBe(first);
  });
});
