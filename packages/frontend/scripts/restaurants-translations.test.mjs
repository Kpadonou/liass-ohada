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
