import { type LiassTableColumnPreference, type LiassTablePreferences } from './table-preferences.model';

const STORAGE_PREFIX = 'liass.table-preferences.';

export function defaultVisibleColumnIds(columns: readonly LiassTableColumnPreference[]): string[] {
  return columns
    .filter((column) => column.required || column.defaultVisible !== false)
    .map((column) => column.id);
}

export function normalizeVisibleColumnIds(
  columns: readonly LiassTableColumnPreference[],
  visibleColumnIds: readonly string[]
): string[] {
  const requestedColumnIds = new Set(visibleColumnIds);

  return columns
    .filter((column) => column.required || requestedColumnIds.has(column.id))
    .map((column) => column.id);
}

export function loadTablePreferences(
  tableId: string,
  columns: readonly LiassTableColumnPreference[]
): string[] {
  const fallbackColumnIds = defaultVisibleColumnIds(columns);
  const storage = getLocalStorage();

  if (!storage) {
    return fallbackColumnIds;
  }

  try {
    const storedValue = storage.getItem(storageKey(tableId));

    if (!storedValue) {
      return fallbackColumnIds;
    }

    const preferences = JSON.parse(storedValue) as Partial<LiassTablePreferences>;

    if (!Array.isArray(preferences.visibleColumnIds)) {
      return fallbackColumnIds;
    }

    return normalizeVisibleColumnIds(columns, preferences.visibleColumnIds);
  } catch {
    return fallbackColumnIds;
  }
}

export function saveTablePreferences(
  tableId: string,
  columns: readonly LiassTableColumnPreference[],
  visibleColumnIds: readonly string[]
): string[] {
  const normalizedColumnIds = normalizeVisibleColumnIds(columns, visibleColumnIds);
  const storage = getLocalStorage();

  if (storage) {
    try {
      storage.setItem(
        storageKey(tableId),
        JSON.stringify({ visibleColumnIds: normalizedColumnIds } satisfies LiassTablePreferences)
      );
    } catch {
      // Local preferences are progressive enhancement; failing to persist must not block the table.
    }
  }

  return normalizedColumnIds;
}

export function resetTablePreferences(
  tableId: string,
  columns: readonly LiassTableColumnPreference[]
): string[] {
  const storage = getLocalStorage();

  if (storage) {
    try {
      storage.removeItem(storageKey(tableId));
    } catch {
      // Local preferences are progressive enhancement; failing to persist must not block the table.
    }
  }

  return defaultVisibleColumnIds(columns);
}

function storageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
