import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantCorrectionDialog, CorrectionDialogData } from './restaurant-correction.dialog';
import { RestaurantCorrectionsQueries } from '../data-access/restaurant-corrections.queries';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { org: 'org', outlet: id(1), user: 'user', revision: 1, identity: 'outlet' };
const api = { createCredit: vi.fn(), createRefund: vi.fn() };
const ref = { close: vi.fn(), disableClose: false };
const creditData = (): CorrectionDialogData => ({
  scope,
  session: id(2),
  currency: 'XOF',
  creditability: {
    finalBillId: id(3),
    currency: 'XOF',
    originalAmountMinor: 1100,
    creditedAmountMinor: 900,
    remainingAmountMinor: 200,
    lines: [
      {
        orderId: id(4),
        itemId: id(5),
        sourceLineIdentity: `${id(4)}#${id(5)}`,
        menuItemId: id(6),
        label: 'GUINESS',
        originalQuantity: 1,
        creditedQuantity: 1,
        remainingQuantity: 0,
        unitAmountMinor: 900,
        originalNetAmountMinor: 900,
        creditedAmountMinor: 900,
        remainingAmountMinor: 0,
        currency: 'XOF',
      },
      {
        orderId: id(4),
        itemId: id(7),
        sourceLineIdentity: `${id(4)}#${id(7)}`,
        menuItemId: id(8),
        label: 'Plat',
        originalQuantity: 3,
        creditedQuantity: 1,
        remainingQuantity: 2,
        unitAmountMinor: 100,
        originalNetAmountMinor: 300,
        creditedAmountMinor: 100,
        remainingAmountMinor: 200,
        currency: 'XOF',
      },
    ],
  },
});
function setup(data = creditData()) {
  TestBed.configureTestingModule({
    imports: [
      RestaurantCorrectionDialog,
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: ref },
      { provide: RestaurantCorrectionsQueries, useValue: api },
      { provide: RestaurantCashQueries, useValue: { context: () => scope } },
    ],
  });
  const fixture = TestBed.createComponent(RestaurantCorrectionDialog);
  fixture.detectChanges();
  return fixture;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.createCredit.mockResolvedValue({ data: { creditNoteReference: 'AV-20261101-12345678' } });
  api.createRefund.mockResolvedValue({ data: { refundReference: 'REF-20261101-12345678' } });
});
afterEach(() => TestBed.resetTestingModule());
it('renders exact remaining quantity and omits the exhausted line control', () => {
  const f = setup();
  expect(f.nativeElement.textContent).toContain('Entièrement crédité');
  expect(f.nativeElement.querySelectorAll('input[type=number]')).toHaveLength(1);
  expect(f.componentInstance.data.creditability!.lines[1].remainingQuantity).toBe(2);
});
it('requires reason and selected positive quantity', async () => {
  const c = setup().componentInstance;
  await c.submit();
  expect(api.createCredit).not.toHaveBeenCalled();
});
it.each([3, -1, 0.5])('rejects unavailable or non-integer quantity %s', async (quantity) => {
  const c = setup().componentInstance;
  c.form.controls.reason.setValue('Retour');
  c.form.controls.quantities.at(1).setValue(quantity);
  await c.submit();
  expect(api.createCredit).not.toHaveBeenCalled();
});
it('submits only intent and closes with the canonical reference', async () => {
  const c = setup().componentInstance;
  c.form.controls.reason.setValue('Retour');
  c.form.controls.quantities.at(1).setValue(1);
  await c.submit();
  const body = api.createCredit.mock.calls[0][2];
  expect(Object.keys(body).sort()).toEqual(['clientRequestId', 'lines', 'reason']);
  expect(body.lines).toEqual([{ orderId: id(4), itemId: id(7), quantity: 1 }]);
  expect(ref.close).toHaveBeenCalledWith({ data: { creditNoteReference: 'AV-20261101-12345678' } });
});
it('preserves intent on concurrency error and uses the same request identity on retry', async () => {
  api.createCredit.mockRejectedValueOnce(Error());
  const c = setup().componentInstance;
  c.form.patchValue({ reason: 'Retour' });
  c.form.controls.quantities.at(1).setValue(1);
  await c.submit();
  expect(c.error()).toBeTruthy();
  await c.submit();
  expect(api.createCredit.mock.calls[0][2].clientRequestId).toBe(
    api.createCredit.mock.calls[1][2].clientRequestId,
  );
});
it('rejects more than sixteen source lines', async () => {
  const data = creditData();
  data.creditability!.lines = Array.from({ length: 17 }, (_, i) => ({
    ...data.creditability!.lines[1],
    itemId: id(20 + i),
  }));
  const c = setup(data).componentInstance;
  c.form.controls.reason.setValue('Retour');
  c.form.controls.quantities.controls.forEach((q) => q.setValue(1));
  await c.submit();
  expect(api.createCredit).not.toHaveBeenCalled();
});
function refundData() {
  return {
    ...creditData(),
    creditability: undefined,
    credit: {
      creditNoteId: id(9),
      creditNoteReference: 'AV-20261101-2C0031A8',
      amountMinor: 900,
    } as CorrectionDialogData['credit'],
    remaining: 500,
    refunded: 400,
  };
}
it('displays the canonical 900/400/500 refund context', () => {
  const f = setup(refundData());
  expect(f.nativeElement.textContent).toContain('900');
  expect(f.nativeElement.textContent).toContain('400');
  expect(f.nativeElement.textContent).toContain('500');
});
it.each(['0', '-1', '501'])('rejects refund amount %s', async (amount) => {
  const c = setup(refundData()).componentInstance;
  c.form.controls.amount.setValue(amount);
  await c.submit();
  expect(api.createRefund).not.toHaveBeenCalled();
  expect(c.refundAmountError()).toBe(
    amount === '501'
      ? 'RESTAURANTS_CORRECTIONS.REFUND_TOO_LARGE'
      : 'RESTAURANTS_CORRECTIONS.REFUND_POSITIVE',
  );
});
it.each(['CASH', 'CARD', 'MOBILE_MONEY'] as const)('sends refund intent for %s', async (method) => {
  const c = setup(refundData()).componentInstance;
  c.form.patchValue({ amount: '100', method, externalReference: ' Justificatif ' });
  await c.submit();
  expect(api.createRefund.mock.calls[0][2]).toMatchObject({
    amountMinor: 100,
    method,
    externalReference: 'Justificatif',
  });
  expect(api.createRefund.mock.calls[0][2]).not.toHaveProperty('currency');
});
it('provides matching FR/EN correction keys', () => {
  expect(Object.keys(fr.RESTAURANTS_CORRECTIONS).sort()).toEqual(
    Object.keys(en.RESTAURANTS_CORRECTIONS).sort(),
  );
});
