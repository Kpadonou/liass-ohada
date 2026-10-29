import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const page = read('src/app/domains/restaurants/feature/restaurant-cash.page.ts');
const checkout = read('src/app/domains/restaurants/feature/restaurant-checkout-visit.component.ts');
test('Cash dynamic and static labels exist in both languages', () => {
  const fr = JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS.CASH;
  const en = JSON.parse(read('public/assets/i18n/en.json')).RESTAURANTS.CASH;
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(fr)) {
    assert.ok(fr[key].trim());
    assert.ok(en[key].trim());
  }
  for (const [, key] of [
    ...page.matchAll(/RESTAURANTS\.CASH\.([A-Z_]+)/g),
    ...checkout.matchAll(/RESTAURANTS\.CASH\.([A-Z_]+)/g),
  ]) {
    if (key === 'CONTEXT_') continue;
    assert.ok(fr[key], key);
    assert.ok(en[key], key);
  }
});
test('Cash has distinct compact mobile rows and a desktop table', () => {
  assert.match(page, /md:hidden/);
  assert.match(page, /hidden overflow-x-auto md:block/);
  assert.match(page, /<table/);
  assert.match(page, /maxWidth: '95vw'/);
});
test('Cash background fetching does not replace canonical content with initial loading', () => {
  assert.doesNotMatch(page, /isFetching\(\)/);
  assert.match(page, /day\.isPending\(\)/);
  assert.match(page, /session\(\); as s/);
});
test('Cash preferences use shared storage and preserve independent derived search', () => {
  assert.match(page, /loadTablePreferences\('restaurants.cash.sessions'/);
  assert.match(page, /saveTablePreferences\(\s*'restaurants.cash.sessions'/);
  assert.match(page, /filtered\(rows:/);
});
