import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('src/app/domains/restaurants/feature/restaurant-cash.page.ts');
const actions = read('src/app/domains/restaurants/feature/restaurant-payment-actions.component.ts');
test('desktop final column and mobile records reuse exactly the same contextual control', () => {
  const payments = page.split('data-activity-payments')[1].split('data-activity-movements')[0];
  assert.equal((payments.match(/<liass-restaurant-payment-actions/g) ?? []).length, 2);
  assert.match(payments, /lg:block/);
  assert.match(payments, /lg:hidden/);
  assert.match(payments, /<td class="px-3">\s*<liass-restaurant-payment-actions/);
  assert.match(actions, /actions\(\).length === 1/);
  assert.match(actions, /more_vert/);
  assert.doesNotMatch(actions, /disabled|refund|delete|edit/i);
  assert.match(page, /data-payment-detail/);
  assert.match(page, /max-w-\[480px\]/);
});
test('FR and EN action labels follow the product contract', () => {
  for (const [lang, expected] of [
    ['fr', ['Consulter', 'Voir l’addition', 'Voir la facture']],
    ['en', ['View details', 'View bill', 'View invoice']],
  ]) {
    const labels = JSON.parse(read(`public/assets/i18n/${lang}.json`)).RESTAURANTS.PAYMENT_ACTIONS;
    assert.deepEqual([labels.DETAIL, labels.BILL, labels.RECEIPT], expected);
    for (const key of [
      'REFERENCE',
      'METHOD',
      'CURRENCY',
      'CAPTURED_AT',
      'TABLE',
      'EXTERNAL_REFERENCE',
      'CAPTURED_BY',
      'CASH_SESSION',
      'BUSINESS_DAY',
      'SERVICE',
      'RECEIPT_AVAILABILITY',
      'AVAILABLE',
      'UNAVAILABLE',
      'OPEN',
      'CLOSED',
    ])
      assert.ok(labels[key]);
  }
});

test('payment and bill drawers present business labels instead of technical identifiers', () => {
  const bill = read('src/app/domains/restaurants/feature/restaurant-payment-bill.component.ts');
  const fields = page.split('paymentFields(row:')[1].split('readonly columns =')[0];
  assert.doesNotMatch(
    fields,
    /value: row\.(capturedByUserId|cashSessionId|businessDayId|guestSessionId)/,
  );
  assert.match(fields, /cashierDisplayName/);
  assert.match(fields, /businessDate\(day\.businessDate\)/);
  assert.match(fields, /value: row\.tableDisplayName/);
  assert.doesNotMatch(bill, /\{\{ bill\.session\.guestSessionId \}\}/);
});
