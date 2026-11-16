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
test('customer documents hide internal identifiers while retaining real payment references', () => {
  const document = read(base + 'restaurant-receipt-document.component.ts');
  const collection = read(base + 'restaurant-document-collection.component.ts');
  assert.doesNotMatch(document, /summary\(\).receiptId/);
  assert.doesNotMatch(document, /summary\(\).outletId|summary\(\).orgId/);
  assert.doesNotMatch(collection, /TECHNICAL_SHORT|short\(row\.invoiceId\)/);
  assert.match(document, /RESTAURANTS.RECEIPT.EXTERNAL_REFERENCE[\s\S]*payment.externalReference/);
  assert.match(document, /fiscal\(\)\?\.seller/);
  assert.doesNotMatch(document, /invoiceReference|fiscalInvoiceNumber/);
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
