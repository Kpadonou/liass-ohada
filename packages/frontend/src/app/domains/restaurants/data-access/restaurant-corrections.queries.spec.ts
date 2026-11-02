import { TestBed } from '@angular/core/testing';
import { RestaurantCorrectionsQueries } from './restaurant-corrections.queries';
import { RestaurantCashQueries } from './restaurant-cash.queries';
const id = '00000000-0000-4000-8000-000000000001';
const scope = { org: 'org', outlet: id, user: 'user', revision: 1, identity: 'one' };
const client = { invalidateQueries: vi.fn().mockResolvedValue(undefined), setQueryData: vi.fn() };
const cash = {
  client,
  request: vi.fn(),
  current: () => ({ queryKey: ['current'] }),
  options: (_s: unknown, path: string) => ({ queryKey: ['detail', path] }),
};
beforeEach(() => {
  vi.clearAllMocks();
  TestBed.configureTestingModule({
    providers: [{ provide: RestaurantCashQueries, useValue: cash }],
  });
});
afterEach(() => TestBed.resetTestingModule());
it('keeps cursor pagination scoped and independent from creditability', async () => {
  const q = TestBed.inject(RestaurantCorrectionsQueries).creditNotes(scope, id);
  expect(q.queryKey).toContain(`sessions/${id}/credit-notes`);
  expect(q.queryKey).toContain(scope.org);
  expect(q.getNextPageParam!({ nextCursor: 'next' } as never, [] as never, undefined, [])).toBe(
    'next',
  );
});
it('reconciles only the selected credit note list after canonical creation', async () => {
  const api = TestBed.inject(RestaurantCorrectionsQueries);
  const result = {
    data: { creditNoteId: id, creditNoteReference: 'AV-20261101-12345678' },
    lines: [],
  };
  cash.request.mockResolvedValue(result);
  const response = await api.createCredit(scope, id, {
    clientRequestId: id,
    reason: 'Retour',
    lines: [{ orderId: id, itemId: id, quantity: 1 }],
  });
  expect(response).toBe(result);
  expect(client.setQueryData).toHaveBeenCalledWith(['detail', `credit-notes/${id}`], result);
  expect(client.invalidateQueries).toHaveBeenCalledTimes(3);
  expect(
    client.invalidateQueries.mock.calls.some(
      ([arg]) => arg.queryKey.includes('documents') && arg.queryKey.includes('credit-notes'),
    ),
  ).toBe(true);
});
it('updates refund history and exact cash context keys only after response', async () => {
  const api = TestBed.inject(RestaurantCorrectionsQueries);
  cash.request.mockResolvedValue({ data: { refundId: id, cashSessionId: id, businessDayId: id } });
  await api.createRefund(scope, id, { clientRequestId: id, amountMinor: 100, method: 'CARD' });
  expect(client.invalidateQueries).toHaveBeenCalledTimes(7);
  expect(client.invalidateQueries.mock.calls.every(([arg]) => arg.queryKey !== undefined)).toBe(
    true,
  );
  expect(cash.request.mock.calls[0][3]).toEqual({
    clientRequestId: id,
    amountMinor: 100,
    method: 'CARD',
  });
});
