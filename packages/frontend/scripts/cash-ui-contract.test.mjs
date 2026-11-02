import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const page = read('src/app/domains/restaurants/feature/restaurant-cash.page.ts');
const checkout = read('src/app/domains/restaurants/feature/restaurant-checkout-visit.component.ts');
const checkoutPage = read('src/app/domains/restaurants/feature/restaurant-checkout.page.ts');
const checkoutStyles = read('src/app/domains/restaurants/feature/restaurant-checkout.page.scss');
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
  assert.match(page, /lg:hidden/);
  assert.match(page, /hidden overflow-x-auto[^"\n]*lg:block/);
  assert.match(page, /liass-data-table/);
  assert.match(page, /<mat-drawer[\s\S]*position="end"/);
  assert.match(page, /data-search-controls/);
  assert.match(page, /data-management-actions/);
  assert.match(page, /<liass-page-header/);
  assert.match(page, /<liass-card/);
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
test('Cash screen responsibilities and row actions remain distinct', () => {
  const sidebar = read('src/app/shared/layout/app-sidebar/app-sidebar.component.ts');
  const service = sidebar
    .split("labelKey: 'RESTAURANTS.SERVICE.GROUP'")[1]
    .split("labelKey: 'RESTAURANTS.CASH.GROUP'")[0];
  const cash = sidebar
    .split("labelKey: 'RESTAURANTS.CASH.GROUP'")[1]
    .split("labelKey: 'RESTAURANTS.UX.CONFIGURATION'")[0];
  assert.doesNotMatch(service, /\/restaurants\/(checkout|cash)/);
  for (const route of ['/restaurants/checkout', '/restaurants/cash', '/restaurants/cash/day'])
    assert.ok(cash.includes(route));
  assert.match(page, /@if \(!management\) \{\s*@if \(session\(\); as s\)/);
  assert.match(page, /@if \(management && caps\.canManageSetup\(\)\)/);
  assert.match(page, /<mat-drawer[^>]*position="end"/);
  assert.match(page, /data-detail-session/);
  assert.match(page, /data-detail-reconciliation/);
  assert.match(page, /data-detail-other-collections/);
  assert.match(page, /data-detail-activity/);
  assert.match(page, /data-session-overflow/);
  assert.match(page, /<mat-icon>more_vert<\/mat-icon>/);
  for (const icon of ['visibility', 'arrow_downward', 'arrow_upward', 'lock'])
    assert.match(page, new RegExp(`<mat-icon>\\s*${icon}\\s*</mat-icon\\s*>`));
  assert.match(page, /row\.session\.status === 'OPEN'/);
  assert.match(page, /move\(row\.session, 'CASH_IN'\)/);
  assert.match(page, /move\(row\.session, 'CASH_OUT'\)/);
  assert.match(page, /close\(row\.session\)/);
  assert.match(page, /\[matTooltip\]="'RESTAURANTS\.CASH\.COLUMNS' \| transloco"/);
  assert.match(page, /\[ariaLabel\]="'RESTAURANTS\.CASH\.COLUMNS' \| transloco"/);
  assert.doesNotMatch(page, /mat-stroked-button \(click\)="preferences\(\)"/);
  for (const [lang, labels] of Object.entries({
    fr: ['Encaisser', 'Ma session', 'Journée de caisse'],
    en: ['Checkout', 'My session', 'Daily cash'],
  })) {
    const source = JSON.parse(read(`public/assets/i18n/${lang}.json`)).RESTAURANTS;
    assert.deepEqual([source.CHECKOUT.TITLE, source.CASH.MY_CASH, source.CASH.DAY_REVIEW], labels);
  }
});

test('Cash visual hierarchy uses canonical controls without changing accepted actions', () => {
  const fr = JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS;
  const en = JSON.parse(read('public/assets/i18n/en.json')).RESTAURANTS;
  assert.equal(fr.UX.PAGES.checkout.TITLE, 'Encaisser');
  assert.equal(en.UX.PAGES.checkout.TITLE, 'Checkout');
  assert.match(page, /data-day-context/);
  assert.match(page, /data-day-summary/);
  assert.match(page, /data-day-summary-details/);
  assert.match(page, /data-search-controls/);
  assert.match(page, /sm:w-80 lg:w-96/);
  const toolbar = page.split('data-cash-toolbar')[1].split('data-session-overflow')[0];
  assert.ok(toolbar.indexOf('data-search-controls') < toolbar.indexOf('data-management-actions'));
  assert.ok(toolbar.indexOf('icon="view_column"') < toolbar.indexOf('icon="lock"'));
  assert.match(toolbar, /tone="brand"[\s\S]*variant="solid"[\s\S]*icon="lock"[\s\S]*closeDay\(\)/);
  assert.match(page, /data-personal-session-status/);
  assert.doesNotMatch(
    page,
    /data-personal-primary-values|data-personal-secondary-values|data-cash-reconciliation/,
  );
  assert.match(page, /data-personal-movements/);
  assert.match(page, /RESTAURANTS.CASH.NO_MOVEMENTS/);
  assert.match(page, /mat-tab-group/);
  assert.match(page, /data-activity-payments/);
  assert.match(page, /data-activity-movements/);
  const header = page.split('data-session-header-actions')[1].split('<mat-tab-group')[0];
  assert.match(header, /tone="brand"[\s\S]*variant="solid"[\s\S]*icon="lock"[\s\S]*close\(s\)/);
  const actions = page.split('data-session-actions')[1].split('<mat-tab-group')[0];
  for (const icon of ['arrow_downward', 'arrow_upward'])
    assert.ok(actions.includes(`icon="${icon}"`));
  assert.ok(actions.indexOf("move(s, 'CASH_IN')") < actions.indexOf("move(s, 'CASH_OUT')"));
  assert.ok(actions.indexOf("move(s, 'CASH_OUT')") < actions.indexOf('close(s)'));
  assert.equal((actions.match(/move\(s, 'CASH_IN'\)/g) ?? []).length, 1);
  assert.equal((actions.match(/move\(s, 'CASH_OUT'\)/g) ?? []).length, 1);
  assert.match(page, /data-session-overflow/);
  assert.match(page, /data-session-detail/);
  assert.match(page, /loadTablePreferences\('restaurants.cash.sessions'/);
});
test('personal workspace omits summary presentation and keeps activity collections separate', () => {
  const personal = page.split('@if (!management)')[1].split('</mat-tab-group')[0];
  assert.doesNotMatch(
    personal,
    /s\.(expectedCashAmountMinor|openingCashAmountMinor|paidByMethodMinor|cashInMinor|cashOutMinor)/,
  );
  assert.match(personal, /timestamp\(s.openedAt\)/);
  assert.match(personal, /liass-status-chip/);
  const movements = page.split('data-personal-movements')[1].split('</section>')[0];
  assert.match(movements, /movements.data\(\)/);
  assert.doesNotMatch(movements, /payments.data\(\)|restaurant-checkout/);
  const fr = JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS.CASH;
  assert.equal(fr.CASH, 'Espèces');
  assert.equal(fr.EXPECTED, 'Espèces attendues');
  assert.equal(fr.MOVEMENTS, 'Mouvements de caisse');
});
test('movement amount and reason retain independent padded table columns', () => {
  const movement = page.split('data-activity-movements')[1].split('</table>')[0];
  const header = movement.split('<thead>')[1].split('</thead>')[0];
  const body = movement.split('<tbody>')[1];
  assert.equal((header.match(/<th\b/g) ?? []).length, 4);
  assert.equal((body.match(/<td\b/g) ?? []).length, 4);
  for (const key of ['DATE_TIME', 'TYPE', 'AMOUNT', 'REASON_COLUMN'])
    assert.ok(header.includes(`RESTAURANTS.CASH.${key}`));
  assert.match(body, /class="px-3 text-right tabular-nums whitespace-nowrap"/);
  assert.match(body, /<td class="px-3 text-left">\s*{{ row.reason }}/);
  assert.doesNotMatch(header, /ACTIONS|Motif obligatoire|MontantMotif/);
  const fr = JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS;
  assert.equal(fr.CHECKOUT.TITLE, 'Encaisser');
  assert.equal(fr.UX.PAGES.checkout.TITLE, 'Encaisser');
  assert.equal(fr.CASH.COLLECTIONS, 'Encaissements');
  assert.equal(fr.CASH.MOVEMENTS, 'Mouvements de caisse');
  assert.equal(fr.CASH.REASON_COLUMN, 'Motif');
  assert.equal(
    JSON.parse(read('public/assets/i18n/en.json')).RESTAURANTS.CASH.COLLECTIONS,
    'Payments',
  );
});

test('payment table preserves contextual columns and exposes read-only contextual actions', () => {
  const payments = page.split('data-activity-payments')[1].split('</table>')[0];
  for (const key of [
    'DATE_TIME',
    'PAYMENT_REFERENCE',
    'TABLE_CONTEXT',
    'METHOD',
    'AMOUNT',
    'STATUS',
  ])
    assert.ok(payments.includes(`RESTAURANTS.CASH.${key}`));
  assert.ok(payments.includes("row.tableDisplayName ?? '—'"));
  assert.ok(payments.includes("row.paymentReference ?? '—'"));
  assert.ok(!payments.includes('row.externalReference'));
  assert.equal(
    JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS.CASH.PAYMENT_REFERENCE,
    'Référence',
  );
  assert.match(payments, /liass-status-chip/);
  assert.match(payments, /formatCashAmount\(row.amountMinor, row.currency\)/);
  assert.doesNotMatch(
    payments,
    /row\.(paymentId|cashSessionId|guestSessionId|orderId)|refund|Rembourser/,
  );
});

test('personal activity tabs and secondary actions retain canonical semantic hierarchy', () => {
  const header = page.split('data-session-header-actions')[1].split('<mat-tab-group')[0];
  assert.match(header, /tone="brand"[\s\S]*variant="solid"/);
  const actions = page.split('data-session-actions')[1].split('<mat-tab-group')[0];
  assert.match(actions, /tone="success"[\s\S]*variant="outline"[\s\S]*arrow_downward/);
  assert.match(actions, /tone="warning"[\s\S]*variant="outline"[\s\S]*arrow_upward/);
  assert.match(page, /\[mat-stretch-tabs\]="false"/);
  assert.match(page, /mat-align-tabs="start"/);
  assert.match(page, /mat-tab-label/);
  assert.match(page, /swap_vert/);
  assert.match(page, /formatNumber\(s.paymentCount\)/);
  assert.match(page, /s\.cashMovementCount !== undefined/);
  assert.match(page, /s\.cashMovementCount \}\}/);
  assert.doesNotMatch(page, /movements\.data\(\)\?\.items\?\.length[^\n]*MOVEMENTS/);
  const fr = JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS.CASH;
  const en = JSON.parse(read('public/assets/i18n/en.json')).RESTAURANTS.CASH;
  assert.equal(fr.CAPTURED, 'Encaissé');
  assert.equal(en.CAPTURED, 'Captured');
  const payments = page.split('data-activity-payments')[1].split('data-activity-movements')[0];
  assert.equal(
    (payments.match(/formatCashAmount\(row.amountMinor, row.currency\)/g) ?? []).length,
    2,
  );
  assert.match(payments, /RESTAURANTS.CASH.ACTIONS/);
  assert.equal((payments.match(/<liass-restaurant-payment-actions/g) ?? []).length, 2);
});

test('Cash activity tabs keep full desktop labels and readable compact mobile labels', () => {
  const tabs = page.split('<mat-tab-group')[1].split('</mat-tab-group')[0];
  const fr = JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS.CASH;
  const en = JSON.parse(read('public/assets/i18n/en.json')).RESTAURANTS.CASH;
  assert.equal(fr.MOVEMENTS, 'Mouvements de caisse');
  assert.equal(fr.MOVEMENTS_SHORT, 'Mouvements');
  assert.equal(en.MOVEMENTS, 'Cash movements');
  assert.equal(en.MOVEMENTS_SHORT, 'Movements');
  assert.match(tabs, /\[disablePagination\]="false"/);
  assert.match(tabs, /<mat-icon aria-hidden="true">description<\/mat-icon\s*>/);
  assert.match(tabs, /<mat-icon aria-hidden="true">assignment_return<\/mat-icon\s*>/);
  for (const field of ['invoiceCount', 'creditNoteCount']) {
    assert.match(tabs, new RegExp(`formatNumber\\(activeDay\\.${field}\\)`));
  }
  const documents = tabs
    .split('RESTAURANTS_DOCUMENTS.INVOICES')[1]
    .split('data-activity-movements')[0];
  assert.match(documents, /@if \(day\.data\(\)\?\.data; as activeDay\)/);
  assert.match(documents, /RESTAURANTS_DOCUMENTS.COUNT_SCOPE/);
  assert.doesNotMatch(documents, /items\.length|pages\.length|search\(\)|history\(\)/);
  assert.equal((tabs.match(/labelClass="!min-w-0 !px-2 sm:!px-6"/g) ?? []).length, 2);
  assert.match(tabs, /class="sm:hidden"[^>]*>[\s\S]*MOVEMENTS_SHORT/);
  assert.match(tabs, /class="hidden sm:inline"[^>]*>[\s\S]*RESTAURANTS.CASH.MOVEMENTS/);
  assert.match(tabs, /formatNumber\(s.paymentCount\)/);
  assert.match(tabs, /s.cashMovementCount !== undefined/);
  assert.doesNotMatch(tabs, /movements\.data\(\)\?\.items\?\.length[^\n]*MOVEMENTS/);
  assert.equal((tabs.match(/hidden overflow-x-auto lg:block/g) ?? []).length, 2);
  assert.equal((tabs.match(/divide-y divide-app-border lg:hidden/g) ?? []).length, 2);
});

test('Cash collections, Checkout, dialogs and drawer use narrow-screen compositions', () => {
  const supervision = page.split('data-cash-toolbar')[1].split('data-personal-session-header')[0];
  assert.match(supervision, /divide-y divide-app-border lg:hidden/);
  assert.match(supervision, /hidden overflow-x-auto[^"\n]*lg:block/);
  assert.match(supervision, /data-session-overflow/);
  assert.match(page, /class="w-full max-w-\[480px\]/);
  assert.match(page, /maxWidth: '95vw'/);
  assert.match(checkoutPage, /lg:grid-cols-\[minmax\(220px,1fr\)_minmax\(0,2fr\)\]/);
  assert.match(checkoutPage, /lg:!hidden/);
  assert.match(checkoutStyles, /@media \(max-width: 1023px\)/);
  assert.match(checkoutStyles, /\.checkout-show-detail \.checkout-master/);
  assert.match(checkout, /maxWidth: '96vw'/);
});
