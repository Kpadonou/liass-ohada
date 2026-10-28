import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { OptimisticNames, canonicalName, beginPendingCreation } from './optimistic-name';
import { newestVersion } from './confirmed-pages';

let client: QueryClient, names: OptimisticNames;
const key = ['restaurants', 'org', 'outlet', 'one', { user: 'u', revision: 1 }, 'items'];
const base = { id: 'item', name: 'Original', version: 1, balanceMilli: 4000, isActive: true };
const value = () => client.getQueryData<typeof base>(key)!;
const begin = (name: string, current = () => true) =>
  names.begin(key, [{ queryKey: key }], 'item', name, current);
beforeEach(() => {
  client = new QueryClient();
  TestBed.configureTestingModule({ providers: [{ provide: QueryClient, useValue: client }] });
  names = TestBed.inject(OptimisticNames);
  client.setQueryData(key, base);
});
afterEach(() => {
  client.clear();
  TestBed.resetTestingModule();
});
it('updates the name in the same event loop and leaves authoritative fields/version unchanged', () => {
  const edit = begin('New');
  expect(value()).toMatchObject({ ...base, name: 'New' });
  expect(canonicalName(value())).toEqual(base);
  edit.success({ ...base, name: 'Normalized', version: 2 });
  expect(value()).toEqual({ ...base, name: 'Normalized', version: 2 });
});
it('rolls back only the failed layer without restoring a stale full snapshot', () => {
  const a = begin('A'),
    b = begin('B');
  a.failure();
  expect(value().name).toBe('B');
  client.setQueryData(key, { ...base, balanceMilli: 9000, version: 2 });
  expect(value()).toMatchObject({ name: 'B', balanceMilli: 9000 });
  b.failure();
  expect(value()).toEqual({ ...base, balanceMilli: 9000, version: 2 });
});
it('rebases later pending intent over earlier success, then rolls back to that success', () => {
  const a = begin('A'),
    b = begin('B');
  a.success({ ...base, name: 'A canonical', version: 2 });
  expect(value()).toMatchObject({ name: 'B', version: 2 });
  b.failure();
  expect(value()).toEqual({ ...base, name: 'A canonical', version: 2 });
});
it.each(['success', 'failure'] as const)('a late A %s cannot overwrite confirmed B', (outcome) => {
  const a = begin('A'),
    b = begin('B');
  const canonical = { ...base, name: 'B canonical', version: 3 };
  b.success(canonical);
  if (outcome === 'success') a.success({ ...base, name: 'A canonical', version: 2 });
  else a.failure();
  client.setQueryData(key, (old) =>
    newestVersion(old as typeof base, { ...base, name: 'A canonical', version: 2 }),
  );
  expect(value()).toEqual(canonical);
});
it('does not let background reads hide pending intent or roll back newer canonical fields', () => {
  const edit = begin('Intent');
  client.setQueryData(key, { ...base, name: 'Remote', version: 3, balanceMilli: 7000 });
  expect(value()).toMatchObject({ name: 'Intent', version: 3, balanceMilli: 7000 });
  edit.failure();
  expect(value()).toEqual({ ...base, name: 'Remote', version: 3, balanceMilli: 7000 });
});
it('strips speculative names before version comparison/canonical response reconciliation', () => {
  const edit = begin('Intent');
  expect(newestVersion(value(), { ...base, name: 'Remote', version: 0 })).toEqual(base);
  edit.failure();
});
it('removes intent when context changes and never patches another context', () => {
  const current = signal(true),
    other = [...key, 'foreign'];
  client.setQueryData(other, base);
  const edit = names.begin(key, [{ queryKey: key, exact: true }], 'item', 'Intent', current);
  TestBed.tick();
  current.set(false);
  TestBed.tick();
  expect(value()).toEqual(base);
  current.set(true);
  TestBed.tick();
  expect(value()).toEqual(base);
  edit.success({ ...base, name: 'Old success', version: 2 });
  expect(client.getQueryData(other)).toEqual(base);
  expect(value()).toEqual(base);
});
it('keeps temporary creation intent in QueryClient without a resource ID and removes only its own row', () => {
  const pending = [...key, 'pending'];
  const endA = beginPendingCreation(client, pending, 'A');
  const endB = beginPendingCreation(client, pending, 'B');
  const rows = client.getQueryData<unknown[]>(pending)!;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ name: 'A', status: 'pending' });
  expect(rows[0]).not.toHaveProperty('id');
  endA();
  expect(client.getQueryData(pending)).toEqual([rows[1]]);
  endB();
  expect(client.getQueryData(pending)).toEqual([]);
});
it('old actor cleanup cannot overwrite replacement data sharing a legacy configuration key', () => {
  const current = signal(true);
  const edit = begin('Old actor intent', current);
  current.set(false);
  const replacement = { ...base, name: 'New actor canonical', version: 1, balanceMilli: 8000 };
  client.setQueryData(key, replacement);
  TestBed.tick();
  edit.failure();
  expect(value()).toEqual(replacement);
});
it('does not touch fresh cache timestamps for unrelated query completions while an edit is pending', () => {
  const edit = begin('Intent');
  const before = client.getQueryState(key)?.dataUpdateCount;
  client.setQueryData(['unrelated'], { name: 'Something else' });
  expect(client.getQueryState(key)?.dataUpdateCount).toBe(before);
  edit.failure();
});
it('a replacement context can edit immediately and old completion cannot remove its pending layer', () => {
  const oldCurrent = signal(true);
  const old = begin('Old intent', oldCurrent);
  oldCurrent.set(false);
  const replacement = begin('New intent');
  expect(value().name).toBe('New intent');
  old.failure();
  expect(value().name).toBe('New intent');
  replacement.failure();
  expect(value()).toEqual(base);
});
