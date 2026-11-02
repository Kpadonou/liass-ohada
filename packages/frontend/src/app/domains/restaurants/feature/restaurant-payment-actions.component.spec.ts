import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import {
  RestaurantPaymentActionsComponent,
  paymentActions,
  PaymentAction,
} from './restaurant-payment-actions.component';
import { RestaurantCashPage } from './restaurant-cash.page';
import { RestaurantCashPaymentRow } from '@liass-ohada/shared/restaurants';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
const row: RestaurantCashPaymentRow = {
  paymentId: 'payment-a',
  cashSessionId: 'cash',
  businessDayId: 'day',
  capturedByUserId: 'cashier',
  capturedAt: '2026-11-01T10:00:00.000Z',
  status: 'CAPTURED',
  amountMinor: 10000,
  currency: 'XOF',
  method: 'CASH',
};
function setup(value = row, lang = 'fr') {
  TestBed.configureTestingModule({
    imports: [
      RestaurantPaymentActionsComponent,
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(RestaurantPaymentActionsComponent);
  fixture.componentRef.setInput('row', value);
  fixture.detectChanges();
  return fixture;
}
describe('Payment contextual actions', () => {
  it('renders historical consultation as one direct accessible action', () => {
    const fixture = setup();
    const button = fixture.nativeElement.querySelector('button');
    expect(button.textContent).toContain('visibility');
    expect(button.getAttribute('aria-label')).toBe('Consulter');
    expect(fixture.nativeElement.textContent).not.toContain('more_vert');
    const emit = vi.fn();
    fixture.componentInstance.activate.subscribe(emit);
    button.click();
    expect(emit).toHaveBeenCalledWith('DETAIL');
  });
  it.each([
    [{ ...row, billSessionId: 'visit' }, ['Consulter', 'Voir l’addition']],
    [
      { ...row, billSessionId: 'visit', receiptId: 'receipt' },
      ['Consulter', 'Voir l’addition', 'Voir la facture'],
    ],
  ])('uses one overflow with only available icon-labelled actions', async (value, labels) => {
    const fixture = setup(value);
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('more_vert');
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(
      items.map((item) => item.textContent!.replace(/visibility|receipt_long|receipt/g, '').trim()),
    ).toEqual(labels);
    expect(items.every((item) => item.querySelector('mat-icon'))).toBe(true);
    const emit = vi.fn();
    fixture.componentInstance.activate.subscribe(emit);
    items.at(-1)!.click();
    expect(emit).toHaveBeenCalledWith(labels.length === 3 ? 'RECEIPT' : 'BILL');
  });
  it('translates the direct control in English', () => {
    const fixture = setup(row, 'en');
    TestBed.inject(TranslocoService).setActiveLang('en');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').getAttribute('aria-label')).toBe(
      'View details',
    );
  });
  it('does not fabricate a receipt target from a receipt identifier alone', () => {
    expect(paymentActions({ receiptId: 'receipt' })).toEqual(['DETAIL']);
    expect(paymentActions({ billSessionId: 'visit' })).toEqual(['DETAIL', 'BILL']);
  });
  it('opens the selected immutable detail, bill or receipt and shares split targets', () => {
    const page = Object.create(RestaurantCashPage.prototype) as RestaurantCashPage;
    Object.assign(page, {
      selectedPaymentId: signal(''),
      paymentView: signal<PaymentAction>('DETAIL'),
      context: () => ({ org: 'org', outlet: 'outlet', user: 'cashier', revision: 1 }),
    });
    const first = { ...row, billSessionId: 'visit', receiptId: 'receipt' };
    const second = {
      ...first,
      paymentId: 'payment-b',
      amountMinor: 30000,
      method: 'MOBILE_MONEY' as const,
    };
    for (const action of ['DETAIL', 'BILL', 'RECEIPT'] as const) {
      page.openPayment(first, action);
      expect(page.selectedPaymentId()).toBe(first.paymentId);
      expect(page.paymentView()).toBe(action);
    }
    page.openPayment(row, 'BILL');
    expect(page.paymentView()).toBe('RECEIPT');
    expect(page.receiptContext(first)).toEqual(page.receiptContext(second));
    page.openPayment(second, 'BILL');
    expect(page.selectedPaymentId()).toBe('payment-b');
  });
});
