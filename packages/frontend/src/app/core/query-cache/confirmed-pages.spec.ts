import { compareId, CursorData, mergeConfirmedRow } from './confirmed-pages';
it('inserts into a complete traversal in identifier order without rewriting cursor boundaries', () => {
  const data: CursorData<{ id: string }> = {
    pages: [{ items: [{ id: 'b' }], nextCursor: 'b' }, { items: [{ id: 'd' }] }],
    pageParams: [undefined, 'b'],
  };
  const merged = mergeConfirmedRow(data, { id: 'a' }, compareId);
  expect(merged.data?.pages.flatMap((p) => p.items).map((r) => r.id)).toEqual(['a', 'b', 'd']);
  expect(merged.data?.pageParams).toEqual(data.pageParams);
  expect(merged.data?.pages[0].nextCursor).toBe('b');
  expect(data.pages[0].items).toEqual([{ id: 'b' }]);
});
it('does not declare a bounded or disjoint traversal exhaustive', () => {
  const partial: CursorData<{ id: string }> = {
    pages: [{ items: [{ id: 'b' }], nextCursor: 'more' }],
    pageParams: [undefined],
  };
  expect(mergeConfirmedRow(partial, { id: 'a' }, compareId).represented).toBe(false);
  const disjoint = { pages: [{ items: [{ id: 'b' }] }], pageParams: ['not-first'] };
  expect(mergeConfirmedRow(disjoint, { id: 'a' }, compareId).represented).toBe(false);
});
it('does not infer completeness from disconnected or repeated pagination boundaries', () => {
  const disconnected: CursorData<{ id: string }> = {
    pages: [{ items: [{ id: 'b' }] }, { items: [{ id: 'd' }] }],
    pageParams: [undefined, undefined],
  };
  expect(mergeConfirmedRow(disconnected, { id: 'a' }, compareId).represented).toBe(false);
  const repeated: CursorData<{ id: string }> = {
    pages: [{ items: [], nextCursor: 'loop' }, { items: [], nextCursor: 'loop' }, { items: [] }],
    pageParams: [undefined, 'loop', 'loop'],
  };
  expect(mergeConfirmedRow(repeated, { id: 'a' }, compareId).represented).toBe(false);
});
