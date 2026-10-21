import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantCheckoutPaymentDialog } from './restaurant-checkout-payment.dialog';
import { RestaurantCheckoutFlow } from '../data-access/restaurant-checkout-flow';
import { RestaurantOrdersApi } from '../data-access/restaurant-orders.api';
import { sessionFixture } from '../data-access/responsible-staff.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import fr from '../../../../../public/assets/i18n/fr.json';
const flow = { pendingPayment: vi.fn(), capture: vi.fn() },
  ref = { close: vi.fn(), disableClose: false };
const data = {
  ctx: { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) },
  session: sessionFixture({ dueMinor: 20000 }),
  orders: [
    {
      orderId: rid(100),
      createdAt: '2026-10-19T10:00:00Z',
      status: 'SUBMITTED',
      dueMinor: 20000,
      paidMinor: 0,
      reservedMinor: 0,
    },
  ],
};
describe('Focused cashier payment form', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flow.capture.mockResolvedValue({ appliedAmountMinor: 8000 });
    TestBed.configureTestingModule({
      imports: [
        RestaurantCheckoutPaymentDialog,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: ref },
        { provide: RestaurantCheckoutFlow, useValue: flow },
        { provide: RestaurantOrdersApi, useValue: { assertContext: vi.fn() } },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  const create = () => {
    const fixture = TestBed.createComponent(RestaurantCheckoutPaymentDialog);
    fixture.detectChanges();
    return fixture;
  };
  it('groups the initial CASH amount and defaults received cash to the applied amount', () => {
    const component = create().componentInstance;
    expect(component.form.controls.amount.value).toBe('20\u00a0000');
    expect(component.form.controls.tender.value).toBe('20\u00a0000');
    expect(component.change()).toBe('0');
  });
  it('formats the applied input and follows it with received cash until manual override', () => {
    const fixture = create(),
      component = fixture.componentInstance;
    component.form.controls.amount.setValue('300000');
    component.groupField('amount');
    fixture.detectChanges();
    expect(component.form.controls.amount.value).toBe('300\u00a0000');
    expect(component.form.controls.tender.value).toBe('300\u00a0000');
    expect(component.change()).toBe('0');

    component.form.controls.amount.setValue('250000');
    component.groupField('amount');
    expect(component.form.controls.tender.value).toBe('250\u00a0000');
    expect(component.change()).toBe('0');
  });
  it('preserves manually overridden tender and recalculates exact change', () => {
    const component = create().componentInstance;
    component.form.controls.tender.setValue('500000');
    component.tenderEdited();
    component.groupField('tender');
    component.form.controls.amount.setValue('275000');
    component.groupField('amount');
    expect(component.form.controls.amount.value).toBe('275\u00a0000');
    expect(component.form.controls.tender.value).toBe('500\u00a0000');
    expect(component.change()).toBe('225\u00a0000');
  });
  it('computes tender and allocation locally without network or waiting state', () => {
    const fixture = create(),
      component = fixture.componentInstance;
    component.form.patchValue({ amount: '8000', tender: '10000' });
    fixture.detectChanges();
    expect(component.change()).toContain('2\u00a0000');
    expect(component.allocationCount()).toBe(1);
    expect(flow.capture).not.toHaveBeenCalled();
    expect(component.busy()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
  });
  it('records exact explicit allocation and separate cash evidence', async () => {
    const component = create().componentInstance;
    component.form.patchValue({ amount: '8000', tender: '10000' });
    await component.submit();
    const input = flow.capture.mock.calls[0][1];
    expect(input.allocations).toEqual([{ orderId: rid(100), amountMinor: 8000 }]);
    expect(input.cashTenderedMinor).toBe(10000);
    expect(input.expectedVersion).toBe(7);
    expect(ref.close).toHaveBeenCalledWith({ result: { appliedAmountMinor: 8000 } });
  });
  it.each(['0', '-1', '1.5', '999999999999999999999'])(
    'keeps invalid amount %s inline, without command or dialog dismissal',
    async (amount) => {
      const component = create().componentInstance;
      component.form.patchValue({ amount, tender: '10000' });
      await component.submit();
      expect(flow.capture).not.toHaveBeenCalled();
      expect(ref.close).not.toHaveBeenCalled();
      expect(component.error()).toContain('Vérifiez');
    },
  );
  it('rejects insufficient cash tender', async () => {
    const component = create().componentInstance;
    component.form.patchValue({ amount: '8000', tender: '7000' });
    await component.submit();
    expect(flow.capture).not.toHaveBeenCalled();
  });
  it.each(['MOBILE_MONEY', 'CARD'] as const)(
    'records confirmed %s without tender/change fields',
    async (method) => {
      const fixture = create(),
        component = fixture.componentInstance;
      component.form.patchValue({
        method,
        amount: '8000',
        tender: '10000',
        reference: ' External confirmation ',
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('confirmation effective');
      expect(fixture.nativeElement.textContent).not.toContain('Espèces reçues');
      expect(fixture.nativeElement.textContent).not.toContain('Monnaie à rendre');
      await component.submit();
      const input = flow.capture.mock.calls[0][1];
      expect(input.method).toBe(method);
      expect(input.cashTenderedMinor).toBeUndefined();
      expect(input.externalReference).toBe('External confirmation');
    },
  );
  it('disables only dialog controls while unresolved command is pending', async () => {
    let done!: (value: unknown) => void;
    flow.capture.mockReturnValue(new Promise((resolve) => (done = resolve)));
    const fixture = create(),
      component = fixture.componentInstance;
    component.form.patchValue({ amount: '8000', tender: '10000' });
    const pending = component.submit();
    await component.submit();
    fixture.detectChanges();
    expect(flow.capture).toHaveBeenCalledTimes(1);
    expect(component.busy()).toBe(true);
    expect({ form: component.form.status, amount: component.form.controls.amount.status }).toEqual({
      form: 'DISABLED',
      amount: 'DISABLED',
    });
    expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
    done({});
    await pending;
  });
  it.each([10, 11])(
    'enforces the %s-Order allocation boundary without splitting a Payment',
    async (count) => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: {
          ...data,
          session: sessionFixture({ dueMinor: count * 2000 }),
          orders: Array.from({ length: count }, (_, i) => ({
            ...data.orders[0],
            orderId: rid(100 + i),
            dueMinor: 2000,
          })),
        },
      });
      const component = create().componentInstance;
      component.form.patchValue({ amount: String(count * 2000), tender: String(count * 2000) });
      await component.submit();
      if (count === 10) {
        expect(flow.capture).toHaveBeenCalledTimes(1);
        expect(flow.capture.mock.calls[0][1].allocations).toHaveLength(10);
      } else {
        expect(flow.capture).not.toHaveBeenCalled();
        expect(ref.close).not.toHaveBeenCalled();
        expect(component.error()).toContain('dix commandes');
      }
    },
  );
  it('creates a new identity for a changed confirmed financial intent after success', async () => {
    const first = create();
    first.componentInstance.form.patchValue({ amount: '8000', tender: '10000' });
    await first.componentInstance.submit();
    first.destroy();
    const second = create();
    second.componentInstance.form.patchValue({ amount: '12000', tender: '12000' });
    await second.componentInstance.submit();
    expect(flow.capture.mock.calls[1][1].clientRequestId).not.toBe(
      flow.capture.mock.calls[0][1].clientRequestId,
    );
    expect(flow.capture.mock.calls[0][1].allocations[0].amountMinor).toBe(8000);
    expect(flow.capture.mock.calls[1][1].allocations[0].amountMinor).toBe(12000);
  });
});
