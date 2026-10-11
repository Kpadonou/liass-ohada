import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const en = JSON.parse(read('public/assets/i18n/en.json')).IDENTITY.ONBOARDING;
const fr = JSON.parse(read('public/assets/i18n/fr.json')).IDENTITY.ONBOARDING;
function keys(value, prefix = '') {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === 'object' ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`]
    )
    .sort();
}
test('onboarding translations have complete English/French parity', () => {
  assert.deepEqual(keys(en), keys(fr));
  for (const copy of [en, fr]) {
    assert.ok(copy.STEPS.PRODUCTS);
    assert.ok(copy.STEPS.REVIEW);
    assert.ok(copy.VALIDATION.PRODUCTS);
    assert.ok(copy.REVIEW.TITLE);
    assert.equal(copy.PRODUCTS.RESTAURANTS.TITLE, 'Liass-Resto');
    for (const product of ['ACCOUNTING', 'SALES', 'RESTAURANTS'])
      assert.ok(copy.PRODUCTS[product].DESCRIPTION);
    assert.doesNotMatch(
      copy.PRODUCTS.RESTAURANTS.DESCRIPTION,
      /operations|opérations|ordering|commandes/i
    );
  }
  assert.equal(en.PRODUCTS.SALES.TITLE, 'Invoicing');
  assert.equal(fr.PRODUCTS.SALES.TITLE, 'Facturation');
});
test('onboarding exposes only independent product cards, translated review and responsive selection state', () => {
  const source = read('src/app/domains/identity/feature/onboarding/onboarding.page.ts');
  const html = read('src/app/domains/identity/feature/onboarding/onboarding.page.html');
  assert.doesNotMatch(source, /code: '(EMECEF|FISCAL_COMPLIANCE)'/);
  assert.match(html, /aria-pressed/);
  assert.match(html, /products-error/);
  assert.match(html, /md:grid-cols-3/);
  assert.match(html, /aria-busy/);
  assert.match(html, /IDENTITY.ONBOARDING.REVIEW.TITLE/);
});
