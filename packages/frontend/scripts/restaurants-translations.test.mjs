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
test('Order abandonment copy is complete and preserves separate service closure', () => {
  const fr = leaves(translations.fr.RESTAURANTS.ORDER_ABANDONMENT);
  const en = leaves(translations.en.RESTAURANTS.ORDER_ABANDONMENT);
  assert.deepEqual(fr.map(([key]) => key).sort(), en.map(([key]) => key).sort());
  for (const [, value] of [...fr, ...en]) {
    assert.ok(value.trim());
    assert.doesNotMatch(value, /CANCEL_ORDER|SALE_REVERSAL|DynamoDB|Lambda|GSI/);
  }
  assert.equal(translations.fr.RESTAURANTS.ORDER_ABANDONMENT.TITLE, 'Annuler la commande');
  assert.equal(translations.en.RESTAURANTS.ORDER_ABANDONMENT.TITLE, 'Cancel order');
  for (const [, value] of [...fr, ...en]) assert.doesNotMatch(value, /abandon/i);
  assert.match(translations.fr.RESTAURANTS.ORDER_ABANDONMENT.CONSEQUENCE, /reste ouvert/);
});
test('commercial collections and correction workflows have complete FR/EN vocabulary', () => {
  for (const namespace of ['RESTAURANTS_DOCUMENTS', 'RESTAURANTS_CORRECTIONS']) {
    const fr = leaves(translations.fr[namespace]);
    const en = leaves(translations.en[namespace]);
    assert.deepEqual(fr.map(([key]) => key).sort(), en.map(([key]) => key).sort());
    for (const [key, value] of [...fr, ...en]) assert.ok(value.trim(), key);
  }
  assert.equal(translations.fr.RESTAURANTS_CORRECTIONS.REASON, 'Motif');
  assert.equal(translations.en.RESTAURANTS_CORRECTIONS.REASON, 'Reason');
  for (const language of ['fr', 'en']) {
    for (const [, value] of leaves(translations[language].RESTAURANTS.RECEIPT))
      assert.doesNotMatch(value, /\breçu\b|\breceipt\b/i);
  }
});
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

test('accepted-item cancellation has complete FR/EN operational copy and no abandonment action', () => {
  const fr = leaves(translations.fr.RESTAURANTS.ITEM_CANCELLATION);
  const en = leaves(translations.en.RESTAURANTS.ITEM_CANCELLATION);
  assert.deepEqual(fr.map(([key]) => key).sort(), en.map(([key]) => key).sort());
  for (const [, value] of [...fr, ...en]) {
    assert.ok(value.trim());
    assert.doesNotMatch(value, /DynamoDB|Lambda|GSI|CANCEL_ORDER/);
  }
  assert.equal(translations.fr.RESTAURANTS.ITEM_CANCELLATION.TITLE, 'Annuler l’article');
  assert.equal(translations.en.RESTAURANTS.ITEM_CANCELLATION.TITLE, 'Cancel item');
});
