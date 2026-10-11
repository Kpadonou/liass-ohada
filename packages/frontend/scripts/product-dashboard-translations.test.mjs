import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const translations = (lang) =>
  JSON.parse(readFileSync(new URL(`../public/assets/i18n/${lang}.json`, import.meta.url), 'utf8'));

test('product dashboards use canonical French/English names and restaurant navigation terminology', () => {
  const fr = translations('fr');
  const en = translations('en');
  for (const [copy, title] of [
    [fr, 'Tableau de bord'],
    [en, 'Dashboard'],
  ]) {
    assert.equal(copy.SALES.DASHBOARD.TITLE, title);
    assert.equal(copy.RESTAURANTS.UX.PAGES.overview.TITLE, title);
    assert.equal(copy.RESTAURANTS.UX.NAV.overview, title);
    assert.equal(copy.RESTAURANTS.UI.KINDS.area, copy.RESTAURANTS.UX.NAV.area);
    assert.equal(copy.RESTAURANTS.UI.KINDS.station, copy.RESTAURANTS.UX.NAV.station);
    assert.ok(copy.SHELL.TOPBAR.NO_ACCESSIBLE_PRODUCT);
    for (const value of Object.values(copy.SALES.DASHBOARD)) assert.ok(value.trim());
  }
  assert.deepEqual(Object.keys(fr.SALES.DASHBOARD).sort(), Object.keys(en.SALES.DASHBOARD).sort());
  assert.equal(fr.RESTAURANTS.UX.NAV.area, 'Espaces de restauration');
  assert.equal(fr.RESTAURANTS.UX.NAV.station, 'Postes de préparation');
});
