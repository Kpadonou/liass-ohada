import { TestBed } from '@angular/core/testing';
import { RestaurantFiscalApi } from './restaurant-fiscal.api';
import { RestaurantFiscalFlow } from './restaurant-fiscal-flow';
import { rid } from './restaurants.test-fixture';

const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
const invoiceId = rid(3);

describe('Automatic fiscal continuation', () => {
  const api = {
    status: vi.fn(),
    initiate: vi.fn(),
    confirm: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: RestaurantFiscalApi, useValue: api }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('executes status, CREATE and CONFIRM once with distinct stable command identities', async () => {
    api.status.mockResolvedValue({ status: 'NOT_STARTED' });
    api.initiate.mockResolvedValue({ status: 'CREATED' });
    api.confirm.mockResolvedValue({ status: 'CONFIRMED' });
    await expect(TestBed.inject(RestaurantFiscalFlow).resume(ctx, invoiceId)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    expect(api.initiate).toHaveBeenCalledOnce();
    expect(api.confirm).toHaveBeenCalledOnce();
    const [, , attemptId, createCommandId] = api.initiate.mock.calls[0];
    const [, , confirmCommandId] = api.confirm.mock.calls[0];
    expect(attemptId).not.toBe(createCommandId);
    expect(confirmCommandId).not.toBe(createCommandId);
  });

  it.each(['UNKNOWN_OUTCOME', 'CREATE_IN_FLIGHT', 'CONFIRM_IN_FLIGHT', 'FAILED'])(
    'treats %s as read-only and never dispatches a provider mutation',
    async (status) => {
      api.status.mockResolvedValue({ status });
      await expect(TestBed.inject(RestaurantFiscalFlow).resume(ctx, invoiceId)).resolves.toEqual({
        status,
      });
      expect(api.initiate).not.toHaveBeenCalled();
      expect(api.confirm).not.toHaveBeenCalled();
    },
  );

  it('does not automatically retry an uncertain CREATE transport outcome', async () => {
    api.status.mockResolvedValue({ status: 'NOT_STARTED' });
    api.initiate.mockRejectedValueOnce(new Error('transport outcome unknown'));
    const flow = TestBed.inject(RestaurantFiscalFlow);
    await expect(flow.resume(ctx, invoiceId)).rejects.toThrow('transport outcome unknown');
    await expect(flow.resume(ctx, invoiceId)).resolves.toEqual({ status: 'NOT_STARTED' });
    expect(api.initiate).toHaveBeenCalledOnce();
    expect(api.confirm).not.toHaveBeenCalled();
  });
});
