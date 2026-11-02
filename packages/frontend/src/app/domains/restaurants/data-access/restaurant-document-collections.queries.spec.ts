import { TestBed } from '@angular/core/testing';
import {
  RestaurantDocumentCollectionsQueries,
  documentCollectionKey,
} from './restaurant-document-collections.queries';
import { RestaurantCashQueries, CashContext } from './restaurant-cash.queries';
const scope: CashContext = {
  org: 'org',
  outlet: '00000000-0000-4000-8000-000000000001',
  user: 'owner',
  revision: 1,
  identity: 'outlet',
};
const filters = {
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-03T00:00:00.000Z',
  businessDayId: '00000000-0000-4000-8000-000000000002',
  q: 'ALTAB',
};
let api: RestaurantDocumentCollectionsQueries;
const request = vi.fn().mockResolvedValue({ items: [], nextCursor: 'next' });
beforeEach(() => {
  request.mockClear();
  TestBed.configureTestingModule({
    providers: [
      RestaurantDocumentCollectionsQueries,
      { provide: RestaurantCashQueries, useValue: { request } },
    ],
  });
  api = TestBed.inject(RestaurantDocumentCollectionsQueries);
});
it.each(['invoices', 'credits'] as const)(
  '%s stays lazy and sends scope/date/day/search/cursor to server',
  async (kind) => {
    const disabled = api[kind](scope, filters, false);
    expect(disabled.enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
    const options = api[kind](scope, filters, true);
    expect(options.enabled).toBe(true);
    const fn = options.queryFn;
    if (typeof fn !== 'function') throw Error('Missing query');
    await fn({ pageParam: 'opaque' } as never);
    const path = request.mock.calls[0][1] as string,
      params = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith(kind === 'invoices' ? 'invoices?' : 'credit-notes?')).toBe(true);
    expect(params.get('from')).toBe(filters.from);
    expect(params.get('to')).toBe(filters.to);
    expect(params.get('businessDayId')).toBe(filters.businessDayId);
    expect(params.get('q')).toBe('ALTAB');
    expect(params.get('cursor')).toBe('opaque');
    expect(JSON.stringify(options.queryKey)).not.toContain('cashSessionId');
  },
);
it('history omits BusinessDay and never accepts an unbounded date range', async () => {
  const options = api.invoices(scope, { from: filters.from, to: filters.to });
  const fn = options.queryFn;
  if (typeof fn !== 'function') throw Error();
  await fn({ pageParam: undefined } as never);
  expect(request.mock.calls[0][1]).not.toContain('businessDayId');
  const bad = api.invoices(scope, { from: '2026-01-01T00:00:00.000Z', to: filters.to });
  const invalid = bad.queryFn;
  if (typeof invalid !== 'function') throw Error();
  expect(() => invalid({ pageParam: undefined } as never)).toThrow();
});
it('collection identity is Outlet-owned and filter/context isolated', () => {
  expect(documentCollectionKey(scope, 'invoices')).not.toEqual(
    documentCollectionKey({ ...scope, outlet: 'other' }, 'invoices'),
  );
  expect(api.invoices(scope, filters).queryKey).not.toEqual(
    api.invoices(scope, { ...filters, q: 'other' }).queryKey,
  );
  expect(api.invoices(scope, filters).queryKey).not.toEqual(api.credits(scope, filters).queryKey);
});
