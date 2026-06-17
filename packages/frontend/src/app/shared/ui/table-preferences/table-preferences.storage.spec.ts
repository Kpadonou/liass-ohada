import { describe, expect, it, beforeEach } from 'vitest';

import {
  defaultVisibleColumnIds,
  loadTablePreferences,
  normalizeVisibleColumnIds,
  resetTablePreferences,
  saveTablePreferences
} from './table-preferences.storage';

const columns = [
  { id: 'code', labelKey: 'TABLE.CODE', required: true },
  { id: 'name', labelKey: 'TABLE.NAME', required: true },
  { id: 'status', labelKey: 'TABLE.STATUS' },
  { id: 'description', labelKey: 'TABLE.DESCRIPTION', defaultVisible: false },
  { id: 'actions', labelKey: 'TABLE.ACTIONS', required: true }
];

describe('table preferences storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps required columns visible when normalizing selected columns', () => {
    expect(normalizeVisibleColumnIds(columns, ['status'])).toEqual([
      'code',
      'name',
      'status',
      'actions'
    ]);
  });

  it('persists optional column visibility by stable table id', () => {
    const visibleColumnIds = saveTablePreferences('accounting.accounts', columns, [
      'code',
      'name',
      'actions'
    ]);

    expect(visibleColumnIds).toEqual(['code', 'name', 'actions']);
    expect(loadTablePreferences('accounting.accounts', columns)).toEqual(['code', 'name', 'actions']);
  });

  it('resets stored preferences to default visible columns', () => {
    saveTablePreferences('accounting.journals', columns, ['code', 'name', 'actions']);

    expect(resetTablePreferences('accounting.journals', columns)).toEqual(defaultVisibleColumnIds(columns));
    expect(loadTablePreferences('accounting.journals', columns)).toEqual([
      'code',
      'name',
      'status',
      'actions'
    ]);
  });
});
