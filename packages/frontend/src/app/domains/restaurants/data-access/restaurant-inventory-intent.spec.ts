import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { RestaurantInventoryIntent } from './restaurant-inventory-intent';
import { RestaurantInventoryQueries } from './restaurant-inventory.queries';
import { inventoryContext as ctx, stockItem, stockMovement } from './inventory.test-fixture';
describe('Durable Inventory movement intent', () => {
  const movement = vi.fn();
  const proposal = { type: 'LOSS' as const, quantity: '2' };
  beforeEach(() => {
    sessionStorage.clear();
    movement.mockReset();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RestaurantInventoryQueries,
          useValue: { api: { assertCurrent: vi.fn() }, movement },
        },
      ],
    });
  });
  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });
  it('creates identity on commit and keeps it across network retry and service recreation', async () => {
    const flow = TestBed.inject(RestaurantInventoryIntent);
    expect(flow.pending(ctx, stockItem().id)).toBeUndefined();
    movement.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await expect(flow.submit(ctx, stockItem().id, proposal)).rejects.toThrow();
    const first = movement.mock.calls[0][2];
    const reopened = TestBed.runInInjectionContext(() => new RestaurantInventoryIntent());
    expect(reopened.pending(ctx, stockItem().id)?.clientRequestId).toBe(first.clientRequestId);
    movement.mockResolvedValue({ data: stockMovement() });
    await reopened.submit(ctx, stockItem().id, proposal);
    expect(movement.mock.calls[1][2]).toEqual(first);
    expect(reopened.pending(ctx, stockItem().id)).toBeUndefined();
    await reopened.submit(ctx, stockItem().id, proposal);
    expect(movement.mock.calls[2][2].clientRequestId).not.toBe(first.clientRequestId);
  });
  it('never retries automatically or replaces an unresolved intent', async () => {
    const flow = TestBed.inject(RestaurantInventoryIntent);
    movement.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
    await expect(flow.submit(ctx, stockItem().id, proposal)).rejects.toThrow();
    await expect(
      flow.submit(ctx, stockItem().id, { ...proposal, quantity: '3' }),
    ).rejects.toThrow();
    expect(movement).toHaveBeenCalledTimes(1);
    expect(flow.pending({ ...ctx, user: 'other' }, stockItem().id)).toBeUndefined();
  });
  it('clears definitely rejected input for correction', async () => {
    const flow = TestBed.inject(RestaurantInventoryIntent);
    movement.mockRejectedValue(new HttpErrorResponse({ status: 400 }));
    await expect(flow.submit(ctx, stockItem().id, proposal)).rejects.toThrow();
    expect(flow.pending(ctx, stockItem().id)).toBeUndefined();
  });
  it('preserves an earlier uncertain identity if authorization later rejects the retry', async () => {
    const flow = TestBed.inject(RestaurantInventoryIntent);
    movement
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }))
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 403 }));
    await expect(flow.submit(ctx, stockItem().id, proposal)).rejects.toThrow();
    const original = flow.pending(ctx, stockItem().id)?.clientRequestId;
    await expect(flow.submit(ctx, stockItem().id, proposal)).rejects.toThrow();
    expect(flow.pending(ctx, stockItem().id)?.clientRequestId).toBe(original);
  });
});
