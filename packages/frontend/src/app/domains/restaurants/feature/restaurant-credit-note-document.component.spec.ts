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
