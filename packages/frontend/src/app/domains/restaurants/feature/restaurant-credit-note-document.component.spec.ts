import { receiptSummary } from '../data-access/restaurant-receipt.test-fixture';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantCreditNoteDocument } from './restaurant-credit-note-document.component';
import { RestaurantReceiptPrint } from '../data-access/restaurant-receipt-print';
import fr from '../../../../../public/assets/i18n/fr.json';

it('renders a confirmed linked FA with original code, own security and printable QR', async () => {
  TestBed.configureTestingModule({ imports: [RestaurantCreditNoteDocument,
    TranslocoTestingModule.forRoot({ langs: { fr },
      translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' }, preloadLangs: true })] });
  const fixture = TestBed.createComponent(RestaurantCreditNoteDocument);
  fixture.componentRef.setInput('summary', { restaurantName: 'Restaurant', outletName: 'Centre',
    tableName: 'Table 1', currency: 'XOF', customer: { name: 'Client', ifu: '1234567890123' } });
  fixture.componentRef.setInput('credit', { data: { creditNoteReference: 'AV-06', amountMinor: 554,
    validatedAt: '2026-11-15T10:00:00Z', finalBillId: 'original-invoice', reason: 'Retour' },
    lines: [{ creditNoteLineId: 'a', creditedQuantity: 2, label: 'Article A', creditedAmountMinor: 200 },
      { creditNoteLineId: 'b', creditedQuantity: 3, label: 'Article B', creditedAmountMinor: 354 }] });
  fixture.componentRef.setInput('fiscal', { status: 'CONFIRMED', originalFiscalReference: 'A'.repeat(24),
    securityElements: { codeMECeFDGI: 'C'.repeat(24), nim: 'NIM', counters: '2/2 FA',
      dateTime: '15/11/2026 10:00:00', qrCode: 'https://example.test/credit' } });
  fixture.detectChanges();
  await fixture.componentInstance.readyForPrint();
  fixture.detectChanges();
  const print = fixture.componentInstance.element.nativeElement;
  expect(print.textContent).toContain('AV-06');
  expect(print.textContent).toContain('1234567890123');
  expect(print.textContent).toContain('A'.repeat(24));
  expect(print.textContent).toContain('C'.repeat(24));
  expect(print.textContent).toContain('2/2 FA');
  expect(print.querySelector('img')?.src).toMatch(/^data:image\/png/);
  const nativePrint = vi.spyOn(window, 'print').mockImplementation(() => {
    const clone = document.querySelector('.liass-receipt-print-root');
    expect(clone?.textContent).toContain('A'.repeat(24));
    expect(clone?.textContent).toContain('C'.repeat(24));
    expect(clone?.querySelector('img')?.src).toMatch(/^data:image\/png/);
  });
  const printer = TestBed.inject(RestaurantReceiptPrint);
  printer.print(print, 'thermal');
  expect(document.querySelector('.liass-receipt-print-root')).toBeNull();
  printer.print(print, 'a4');
  expect(nativePrint).toHaveBeenCalledTimes(2);
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('Signed credit receipt presentation', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('renders signed values, tax summary and print reference without fabricating security', async () => {
    TestBed.configureTestingModule({ imports: [RestaurantCreditNoteDocument,
      TranslocoTestingModule.forRoot({ langs: { fr }, translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' } })] });
    const fixture = TestBed.createComponent(RestaurantCreditNoteDocument);
    fixture.componentRef.setInput('summary', { ...receiptSummary(), currency: 'XOF' });
    fixture.componentRef.setInput('credit', { data: { creditNoteReference: 'AV-20261125-12345678', amountMinor: 14500,
      reason: 'Correction', validatedAt: '2026-11-25T10:00:00.000Z' }, lines: [
      { creditNoteLineId: 'a', creditedQuantity: 2, label: 'Exonéré', creditedAmountMinor: 10000 },
      { creditNoteLineId: 'b', creditedQuantity: 3, label: 'Taxable', creditedAmountMinor: 4500 }] });
    fixture.componentRef.setInput('fiscal', { status: 'NOT_STARTED', originalPrintedReference: 'ED04999905 - 1378',
      creditPreparation: { status: 'BLOCKED', reason: 'PROVIDER_CREDIT_WIRE_SEMANTICS_UNVERIFIED', providerMutationAllowed: false },
      creditTaxSummary: [{ taxGroup: 'B', netMinor: -3814, taxMinor: -686, totalMinor: -4500 }], securityElements: null });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const text = fixture.nativeElement.textContent.replace(/[\s\u00a0\u202f]/g, '');
    expect(text).toContain('-14500'); expect(text).toContain('-2×'); expect(text).toContain('-3×');
    expect(text).toContain('-3814'); expect(text).toContain('-686');
    expect(text).toContain('ED04999905-1378');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });
});
