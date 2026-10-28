import type { InfiniteData } from '@tanstack/angular-query-experimental';

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}
export type CursorData<T> = InfiniteData<CursorPage<T>, string | undefined>;

export function newestVersion<T extends { version: number }>(
  current: T | undefined,
  incoming: T,
): T {
  return current && current.version > incoming.version ? current : incoming;
}

/** Cache surgery only. Callers own membership, ordering and version semantics. Never change cursors. */
export function mergeConfirmedRow<T extends { id: string }>(
  data: CursorData<T> | undefined,
  incoming: T,
  compare: (left: T, right: T) => number,
  options: { prefer?: (current: T, incoming: T) => T; insertWithinLoadedRange?: boolean } = {},
): { data: CursorData<T> | undefined; represented: boolean } {
  if (!data?.pages.length) return { data, represented: false };
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((row) => {
      if (row.id !== incoming.id) return row;
      found = true;
      return options.prefer ? options.prefer(row, incoming) : incoming;
    }),
  }));
  if (found) return { data: { ...data, pages }, represented: true };
  const contiguous =
    data.pageParams.length === pages.length &&
    data.pageParams[0] === undefined &&
    new Set(data.pageParams).size === data.pageParams.length &&
    pages.every(
      (_page, index) =>
        index === 0 ||
        (!!pages[index - 1].nextCursor && data.pageParams[index] === pages[index - 1].nextCursor),
    );
  const lastRow = pages.flatMap((page) => page.items).at(-1);
  const complete = !pages.at(-1)!.nextCursor;
  // A partial traversal cannot prove where an arbitrary new row belongs. Immutable
  // history callers may explicitly insert a row inside the already-covered range.
  if (
    !contiguous ||
    (!complete && !(options.insertWithinLoadedRange && lastRow && compare(incoming, lastRow) <= 0))
  )
    return { data, represented: false };
  const index = pages.findIndex(
    (page) => page.items.length > 0 && compare(incoming, page.items.at(-1)!) <= 0,
  );
  const target = index < 0 ? pages.length - 1 : index;
  pages[target] = { ...pages[target], items: [...pages[target].items, incoming].sort(compare) };
  return { data: { ...data, pages }, represented: true };
}

/** Identifier-ordered endpoint collections; never use this for label/date-ordered APIs. */
export const compareId = (left: { id: string }, right: { id: string }) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
