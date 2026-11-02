import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const base = 'src/app/domains/restaurants/feature/';
test('Invoice is a clean immutable document; CreditNote detail never layers a drawer inside it', () => {
  const invoice = read(base + 'restaurant-receipt.page.ts');
  assert.doesNotMatch(invoice, /RestaurantCorrectionsComponent|liass-restaurant-corrections/);
  const collection = read(base + 'restaurant-document-collection.component.ts');
  assert.doesNotMatch(collection, /open\(row, 'corrections'\)/);
  assert.match(collection, /showCredits\(row.invoiceId\)/);
  assert.match(collection, /\[detailOnly\]="true"/);
  const detail = read(base + 'restaurant-corrections.component.ts');
  assert.match(
    detail,
    /@if \(detailOnly\(\)\) \{[\s\S]*?ngTemplateOutlet="detailContent"[\s\S]*?\} @else \{/,
  );
});
test('Invoice UUID labels remain technical, including print, without relabeling payment references', () => {
  const document = read(base + 'restaurant-receipt-document.component.ts');
  assert.match(document, /RESTAURANTS.RECEIPT.REFERENCE[\s\S]*summary\(\).receiptId/);
  assert.match(document, /RESTAURANTS.RECEIPT.EXTERNAL_REFERENCE[\s\S]*payment.externalReference/);
  assert.doesNotMatch(document, /invoiceReference|fiscalInvoiceNumber/);
  for (const [lang, full, short] of [
    ['fr', 'Référence technique', 'Réf. technique'],
    ['en', 'Technical reference', 'Technical ref.'],
  ]) {
    const t = JSON.parse(read('public/assets/i18n/' + lang + '.json'));
    assert.equal(t.RESTAURANTS.RECEIPT.REFERENCE, full);
    assert.equal(t.RESTAURANTS_DOCUMENTS.TECHNICAL_SHORT, short);
  }
  assert.equal(
    JSON.parse(read('public/assets/i18n/fr.json')).RESTAURANTS.RECEIPT.OPERATIONAL,
    'Facture commerciale · non fiscale',
  );
});
test('both workspace compositions connect contextual search without owning document totals', () => {
  const page = read(base + 'restaurant-cash.page.ts');
  assert.equal((page.match(/\(viewCredits\)="viewInvoiceCredits\(\$event\)"/g) ?? []).length, 2);
  assert.equal((page.match(/\[contextualInvoice\]="creditContext\(\)"/g) ?? []).length, 2);
  assert.equal((page.match(/\(contextCleared\)="creditContext.set\(null\)"/g) ?? []).length, 2);
  assert.match(page, /formatNumber\(activeDay.invoiceCount\)/);
  assert.match(page, /formatNumber\(activeDay.creditNoteCount\)/);
  const query = read(
    'src/app/domains/restaurants/data-access/restaurant-document-collections.queries.ts',
  );
  assert.match(query, /URLSearchParams/);
});
