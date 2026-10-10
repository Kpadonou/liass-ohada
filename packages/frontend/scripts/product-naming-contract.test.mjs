import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(frontendRoot, '../..');
const readFrontend = (path) => readFileSync(resolve(frontendRoot, path), 'utf8');
const readRepository = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');

const french = JSON.parse(readFrontend('public/assets/i18n/fr.json'));
const english = JSON.parse(readFrontend('public/assets/i18n/en.json'));

test('Liass-Resto is the untranslated public name and remains future-only', () => {
  const frenchProduct = french.PUBLIC.ROADMAP.DOMAINS.RESTAURANTS;
  const englishProduct = english.PUBLIC.ROADMAP.DOMAINS.RESTAURANTS;
  const landingSource = readFrontend('src/app/core/public/public-landing.page.ts');

  assert.equal(frenchProduct.TITLE, 'Liass-Resto');
  assert.equal(englishProduct.TITLE, 'Liass-Resto');
  assert.match(frenchProduct.DESCRIPTION, /restaurants et bars/);
  assert.match(englishProduct.DESCRIPTION, /restaurants and bars/);
  assert.match(landingSource, /id: 'restaurants'.*status: 'COMING'/);
});

test('RESTO-0 introduces only the canonical foundation route and product entitlement', () => {
  const routes = readFrontend('src/app/core/routing/app.routes.ts');
  const productCodes = readRepository('packages/shared/src/shared/product-access.ts');

  assert.match(routes, /path:\s*['"]restaurants['"]/);
  assert.doesNotMatch(routes, /path:\s*['"]liass-resto['"]/);
  assert.doesNotMatch(productCodes, /LIASS_RESTO/);
  assert.match(productCodes, /RESTAURANTS/);
});
