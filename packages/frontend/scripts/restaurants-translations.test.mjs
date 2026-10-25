import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const translations = Object.fromEntries(
  ['fr', 'en'].map((language) => [
    language,
    JSON.parse(
      readFileSync(new URL(`../public/assets/i18n/${language}.json`, import.meta.url), 'utf8'),
    ),
  ]),
);
function leaves(object, path = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${path}${key}`, value]] : leaves(value, `${path}${key}.`),
  );
}
test('restaurant interface translations belong to the product root and match in French and English', () => {
  const french = leaves(translations.fr.RESTAURANTS.UI);
  const english = leaves(translations.en.RESTAURANTS.UI);
  assert.deepEqual(french.map(([key]) => key).sort(), english.map(([key]) => key).sort());
  for (const [, value] of [...french, ...english]) assert.ok(value.trim());
  for (const language of ['fr', 'en']) {
    assert.equal(translations[language].RESTAURANTS.PAGE.TITLE, 'Liass-Resto');
    for (const key of ['OVERVIEW', 'SETUP', 'MENU'])
      assert.ok(translations[language].RESTAURANTS.UI.NAV[key]);
    assert.equal(translations[language].SHELL.PAGES.UI, undefined);
  }
});

test('restaurant shell task titles, descriptions and primary actions are translated in both languages', () => {
  const french = leaves(translations.fr.RESTAURANTS.UX);
  const english = leaves(translations.en.RESTAURANTS.UX);
  assert.deepEqual(french.map(([key]) => key).sort(), english.map(([key]) => key).sort());
  for (const [, value] of [...french, ...english]) {
    assert.ok(value.trim());
    assert.doesNotMatch(value, /DynamoDB|Lambda|GSI|PreparationTicket/);
  }
  for (const language of ['fr', 'en']) assert.ok(translations[language].SHELL.SIDEBAR.PRODUCTS);
});

test('restaurant navigation labels remain concise and distinct from task titles', () => {
  for (const language of ['fr', 'en']) {
    const navigation = translations[language].RESTAURANTS.UX.NAV;
    assert.equal(navigation.restaurant, 'Restaurant');
    assert.equal(navigation.menu, 'Menu');
    assert.ok(translations[language].SHELL.SIDEBAR.PLATFORM);
  }
  assert.equal(translations.fr.RESTAURANTS.UX.NAV.station, 'Postes de préparation');
  assert.equal(translations.en.RESTAURANTS.UX.NAV.station, 'Preparation stations');
  assert.equal(translations.fr.RESTAURANTS.UX.NAV.MENU_SECTION, 'Carte');
  assert.equal(translations.en.RESTAURANTS.UX.NAV.MENU_SECTION, 'Menu');
  assert.equal(translations.fr.RESTAURANTS.UX.EMPTY.outlet.TITLE, 'Aucun établissement');
  assert.equal(translations.en.RESTAURANTS.UX.EMPTY.outlet.TITLE, 'No locations yet');
});

test('active product and restaurant dashboard labels remain translated', () => {
  assert.equal(translations.fr.SHELL.SIDEBAR.ACTIVE_PRODUCT, 'Produit actif');
  assert.equal(translations.en.SHELL.SIDEBAR.ACTIVE_PRODUCT, 'Active product');
  assert.equal(translations.fr.RESTAURANTS.UX.NAV.overview, 'Tableau de bord');
  assert.equal(translations.en.RESTAURANTS.UX.NAV.overview, 'Dashboard');
});

test('restaurant dashboard naming is consistent in page, navigation and breadcrumb title keys', () => {
  for (const [language, title] of [
    ['fr', 'Tableau de bord'],
    ['en', 'Dashboard'],
  ]) {
    assert.equal(translations[language].RESTAURANTS.UX.PAGES.overview.TITLE, title);
    assert.equal(translations[language].RESTAURANTS.UX.NAV.overview, title);
    assert.equal(translations[language].RESTAURANTS.UI.NAV.OVERVIEW, title);
  }
});

test('Restaurants service lifecycle copy never exposes Visit/Visite terminology', () => {
  for (const language of ['fr', 'en']) {
    for (const [key, value] of leaves(translations[language].RESTAURANTS)) {
      assert.doesNotMatch(value, /\bvisits?\b|\bvisites?\b/i, key);
    }
  }
});
test('Guest lifecycle has manual refresh and no periodic network scheduler', () => {
  for (const file of [
    'feature/restaurant-guest.page.ts',
    'data-access/restaurant-guest-submissions.ts',
    'data-access/restaurant-guest.api.ts',
    'data-access/restaurant-guest-carte.queries.ts',
  ]) {
    const source = readFileSync(
      new URL(`../src/app/domains/restaurants/${file}`, import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(source, /setInterval|refetchInterval|\binterval\s*\(/);
  }
  const page = readFileSync(
    new URL('../src/app/domains/restaurants/feature/restaurant-guest.page.ts', import.meta.url),
    'utf8',
  );
  assert.match(page, /RESTAURANTS\.GUEST\.REFRESH/);
  assert.doesNotMatch(page, /location\.reload/);
});
