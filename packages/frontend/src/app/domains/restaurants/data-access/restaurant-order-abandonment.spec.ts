import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule, TranslocoService } from '@ngneat/transloco';
import * as c from '@liass-ohada/shared/restaurants';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantOrderAbandonment, orderAbandonable } from './restaurant-order-abandonment';
import { RestaurantOrderAbandonmentDialog } from '../feature/restaurant-order-abandonment.dialog';
import { RestaurantOrdersApi } from './restaurant-orders.api';
import { RestaurantOrdersQueries } from './restaurant-orders.queries';
import { RestaurantsApi } from './restaurants.api';
import { RestaurantsCapabilities } from './restaurants-capabilities';
import { restaurantKeys } from './restaurants.queries';
import { inventoryKeys } from './restaurant-inventory.keys';
import { NotificationService } from '../../../core/notifications/notification.service';
import { checkoutClosureBlockers } from '../utils/restaurant-checkout';
import { rid } from './restaurants.test-fixture';
import { serviceContext as ctx } from './service-preparation.test-fixture';

const order = () =>
  c.RestaurantOrderSchema.parse({
    orgId: ctx.org,
    outletId: ctx.outlet,
    guestSessionId: ctx.session,
    orderId: rid(20),
    schemaVersion: 1,
    orderType: 'DINE_IN',
    status: 'SUBMITTED',
    currency: 'XOF',
    createdAt: '2026-10-18T10:00:00.000Z',
    createdBy: 'owner',
    version: 7,
    financialRevision: 0,
    lineCount: 1,
    acceptedLineCount: 1,
    draftLineCount: 0,
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
  });
const cancelled = () => ({
  ...order(),
  status: 'CANCELLED' as const,
  version: 8,
  closedAt: '2026-11-03T10:00:00.000Z',
  closedBy: 'owner',
});
let client: QueryClient;
let role: string;
const api = { assertContext: vi.fn(), abandon: vi.fn() };
const ref = { close: vi.fn(), disableClose: false };
const notifications = { success: vi.fn(), error: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  role = 'OWNER';
  ref.disableClose = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 300000 } } });
  api.abandon.mockResolvedValue(cancelled());
  TestBed.configureTestingModule({
    imports: [
      RestaurantOrderAbandonmentDialog,
      TranslocoTestingModule.forRoot({
        langs: { fr, en },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      { provide: QueryClient, useValue: client },
      { provide: RestaurantOrdersApi, useValue: api },
      { provide: RestaurantsApi, useValue: {} },
      {
        provide: RestaurantsCapabilities,
        useValue: { canManageSetup: () => ['OWNER', 'MANAGER'].includes(role) },
      },
      {
        provide: MAT_DIALOG_DATA,
        useFactory: () => ({ context: ctx, order: order(), tableName: 'Terrasse jardin' }),
      },
      { provide: MatDialogRef, useValue: ref },
      { provide: NotificationService, useValue: notifications },
    ],
  });
});
afterEach(() => {
  TestBed.resetTestingModule();
  client.clear();
});

it.each(['OWNER', 'MANAGER'])(
  'sends the canonical request as %s without deriving eligibility from accepted quantity',
  async (current) => {
    role = current;
    const flow = TestBed.inject(RestaurantOrderAbandonment);
    await flow.abandon(
      ctx,
      { ...order(), status: 'SUBMITTED', acceptedLineCount: 2 },
      '  Client left  ',
    );
    expect(api.abandon).toHaveBeenCalledWith(ctx, rid(20), {
      clientRequestId: expect.any(String),
      expectedVersion: 7,
      reason: 'Client left',
    });
    expect(
      c.CancelRestaurantOrderRequestSchema.safeParse(api.abandon.mock.calls[0][2]).success,
    ).toBe(true);
  },
);
it.each(['WAITER', 'CASHIER', 'KITCHEN'])(
  'does not grant %s management cancellation',
  async (current) => {
    role = current;
    await expect(
      TestBed.inject(RestaurantOrderAbandonment).abandon(ctx, order(), 'Reason'),
    ).rejects.toMatchObject({ status: 403 });
    expect(api.abandon).not.toHaveBeenCalled();
  },
);
it('keeps terminal states ineligible but does not simulate rich server guards', () => {
  expect(orderAbandonable(order())).toBe(true);
  expect(
    orderAbandonable({
      ...order(),
      status: 'SUBMITTED',
      acceptedLineCount: 1,
      dueMinor: 500,
      reservedMinor: 100,
      draftLineCount: 0,
    }),
  ).toBe(true);
  expect(orderAbandonable(cancelled())).toBe(false);
  expect(orderAbandonable({ ...order(), status: 'CLOSED' })).toBe(false);
  expect(orderAbandonable({ ...order(), status: 'DRAFT' })).toBe(false);
  expect(orderAbandonable({ ...order(), status: 'SUBMITTED', draftLineCount: 1 })).toBe(true);
  expect(orderAbandonable({ ...order(), resolutionKind: 'TECHNICAL_EMPTY_DRAFT' })).toBe(false);
});
it('updates only the confirmed Order and refreshes canonical session/floor without closing or locally decrementing them', async () => {
  const queries = TestBed.inject(RestaurantOrdersQueries);
  const flow = TestBed.inject(RestaurantOrderAbandonment);
  const sibling = { ...order(), orderId: rid(21) };
  const sessionKey = restaurantKeys.session(
    ctx.org,
    ctx.outlet,
    ctx.session,
    ctx.user,
    ctx.revision,
  );
  const floorKey = restaurantKeys.floor(ctx.org, ctx.outlet);
  const foreign = queries.key({ ...ctx, user: 'foreign' }, 'orders');
  const stock = inventoryKeys.items({ ...ctx, identity: 'review' });
  const foreignStock = inventoryKeys.items({ ...ctx, outlet: rid(99), identity: 'review' });
  const pages = { pages: [{ items: [order(), sibling] }], pageParams: [undefined] };
  client.setQueryData(queries.key(ctx, 'orders'), pages);
  client.setQueryData(foreign, pages);
  client.setQueryData(sessionKey, { status: 'OPEN', openOrderCount: 2 });
  client.setQueryData(floorKey, { occupied: true });
  client.setQueryData(stock, { items: [] });
  client.setQueryData(foreignStock, { items: [] });
  await flow.abandon(ctx, order(), 'Reason');
  expect(client.getQueryData(queries.key(ctx, 'order', rid(20)))).toEqual(cancelled());
  expect(client.getQueryData(queries.key(ctx, 'orders'))).toEqual({
    ...pages,
    pages: [{ items: [cancelled(), sibling] }],
  });
  expect(client.getQueryData(sessionKey)).toEqual({ status: 'OPEN', openOrderCount: 2 });
  expect(client.getQueryData(floorKey)).toEqual({ occupied: true });
  expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(floorKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(stock)?.isInvalidated).toBe(true);
  expect(client.getQueryState(foreignStock)?.isInvalidated).toBe(false);
  expect(client.getQueryState(foreign)?.isInvalidated).toBe(false);
  expect(api.abandon).toHaveBeenCalledTimes(1);
});
it('leaves normal closure separate and gated by canonical remaining Orders', () => {
  const session = {
    status: 'OPEN',
    orderCount: 1,
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
  } as c.GuestSessionRead;
  expect(checkoutClosureBlockers(session, [order()], true)).toEqual([]);
  expect(checkoutClosureBlockers(session, [cancelled()], true)).toEqual([]);
  expect(
    checkoutClosureBlockers(
      { ...session, orderCount: 2 },
      [cancelled(), { ...order(), orderId: rid(21), draftLineCount: 1 }],
      true,
    ),
  ).toContain('DRAFT');
  expect(checkoutClosureBlockers(session, [cancelled()], false)).toContain('INCOMPLETE');
});
it('retains exact UUID/version/reason across unknown result, blocks concurrent submit, and can replay even after canonical terminal refresh', async () => {
  const flow = TestBed.inject(RestaurantOrderAbandonment);
  let reject!: (error: unknown) => void;
  api.abandon.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const first = flow.abandon(ctx, order(), 'Original reason');
  const check = expect(first).rejects.toThrow();
  await expect(flow.abandon(ctx, order(), 'Other')).rejects.toThrow('pending');
  reject(new HttpErrorResponse({ status: 0 }));
  await check;
  const intent = api.abandon.mock.calls[0][2];
  await flow.abandon(ctx, cancelled(), 'Changed');
  expect(api.abandon.mock.calls[1][2]).toEqual(intent);
  expect(flow.pending(ctx, rid(20))).toBeUndefined();
});
it('rejects foreign context and retains an intent on malformed/foreign result', async () => {
  const flow = TestBed.inject(RestaurantOrderAbandonment);
  await expect(flow.abandon({ ...ctx, session: rid(99) }, order(), 'Reason')).rejects.toThrow(
    'context',
  );
  expect(api.abandon).not.toHaveBeenCalled();
  api.abandon.mockResolvedValue({ ...cancelled(), orgId: 'foreign' });
  await expect(flow.abandon(ctx, order(), 'Reason')).rejects.toThrow('response');
  expect(flow.pending(ctx, rid(20))).toBeTruthy();
});
it('retains the in-flight guard through reconciliation and does not reinterpret a confirmed success on refresh failure', async () => {
  const flow = TestBed.inject(RestaurantOrderAbandonment);
  let finish!: () => void;
  vi.spyOn(flow, 'reconcile').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = flow.abandon(ctx, order(), 'Reason');
  await vi.waitFor(() => expect(flow.reconcile).toHaveBeenCalled());
  await expect(flow.abandon(ctx, order(), 'Reason')).rejects.toThrow('pending');
  expect(api.abandon).toHaveBeenCalledTimes(1);
  finish();
  expect(await first).toEqual(cancelled());
  vi.mocked(flow.reconcile).mockRejectedValueOnce(new Error('Refresh unavailable'));
  api.abandon.mockResolvedValueOnce({ ...cancelled(), orderId: rid(21) });
  expect(await flow.abandon(ctx, { ...order(), orderId: rid(21) }, 'Reason')).toEqual({
    ...cancelled(),
    orderId: rid(21),
  });
  expect(flow.pending(ctx, rid(21))).toBeUndefined();
});
it('dialog shows Order/table context and validates required trimmed 1–500 reason', async () => {
  const f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('Terrasse jardin');
  expect(f.nativeElement.textContent).toContain('Le service reste ouvert');
  expect(f.nativeElement.querySelector('textarea').getAttribute('maxlength')).toBe('500');
  for (const value of ['', '   ', 'x'.repeat(501)]) {
    f.componentInstance.form.controls.reason.setValue(value);
    await f.componentInstance.submit();
    expect(f.componentInstance.form.invalid).toBe(true);
  }
  expect(api.abandon).not.toHaveBeenCalled();
  f.componentInstance.form.controls.reason.setValue(' ' + 'x'.repeat(500) + ' ');
  expect(f.componentInstance.form.valid).toBe(true);
});
it.each([
  ['fr', 'Annuler la commande', 'La commande sera annulée'],
  ['en', 'Cancel order', 'The order will be cancelled'],
])('uses cancellation wording in the %s dialog and confirmation', (lang, label, consequence) => {
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
  f.detectChanges();
  expect(f.nativeElement.querySelector('h2').textContent).toContain(label);
  expect(f.nativeElement.querySelector('button[type="submit"]').textContent).toContain(label);
  expect(f.nativeElement.textContent).toContain(consequence);
  expect(f.nativeElement.textContent).not.toMatch(/abandon/i);
});
it('dialog prevents duplicate submit and closes only after confirmed canonical success', async () => {
  const f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
  f.detectChanges();
  let finish!: (value: unknown) => void;
  api.abandon.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.componentInstance.form.controls.reason.setValue('Reason');
  const first = f.componentInstance.submit();
  await vi.waitFor(() => expect(api.abandon).toHaveBeenCalledTimes(1));
  await f.componentInstance.submit();
  expect(api.abandon).toHaveBeenCalledTimes(1);
  expect(ref.close).not.toHaveBeenCalled();
  expect(ref.disableClose).toBe(true);
  expect(f.componentInstance.form.disabled).toBe(true);
  finish(cancelled());
  await first;
  expect(ref.close).toHaveBeenCalledWith(cancelled());
  expect(notifications.success).toHaveBeenCalled();
});
it.each([
  ['RESTAURANTS_UNPAID_CLOSE', 'préparations restantes'],
  ['RESTAURANTS_UNPAID_CLOSE', 'paiement en cours'],
  ['RESTAURANTS_WRITE_CONFLICT', 'a changé'],
  ['RESTAURANTS_IDEMPOTENCY_CONFLICT', 'autre opération'],
])('shows safe %s guard feedback containing %s', async (code, message) => {
  const f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
  f.detectChanges();
  api.abandon.mockRejectedValue(
    new HttpErrorResponse({ status: 409, error: { error: { code, message: code } } }),
  );
  f.componentInstance.form.controls.reason.setValue('Reason');
  await f.componentInstance.submit();
  f.detectChanges();
  const text = f.nativeElement.querySelector('[role="alert"]').textContent;
  expect(text).toContain(message);
  expect(text).not.toContain(code);
  expect(ref.close).not.toHaveBeenCalled();
  expect(f.componentInstance.blocked()).toBe(true);
  expect(TestBed.inject(RestaurantOrderAbandonment).pending(ctx, rid(20))).toBeUndefined();
});
it('reopens an ambiguous dialog with the same locked request and retry action', async () => {
  let f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
  f.detectChanges();
  api.abandon.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  f.componentInstance.form.controls.reason.setValue('Reason');
  await f.componentInstance.submit();
  f.destroy();
  f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
  f.detectChanges();
  expect(f.componentInstance.form.disabled).toBe(true);
  expect(f.nativeElement.textContent).toContain('Réessayer la même annulation');
  await f.componentInstance.submit();
  expect(api.abandon.mock.calls[1][2]).toEqual(api.abandon.mock.calls[0][2]);
});
it.each([1440, 900, 390, 446])(
  'keeps the reason and wrapped confirmation actions reachable at %spx (structural)',
  (width) => {
    const previous = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    try {
      const f = TestBed.createComponent(RestaurantOrderAbandonmentDialog);
      f.detectChanges();
      const textarea = f.nativeElement.querySelector('textarea');
      expect(textarea.closest('[hidden]')).toBeNull();
      expect(textarea.getAttribute('rows')).toBe('3');
      expect(f.nativeElement.querySelector('mat-form-field').classList.contains('w-full')).toBe(
        true,
      );
      const actions = f.nativeElement.querySelector('mat-dialog-actions');
      expect(actions.classList.contains('flex-wrap')).toBe(true);
      expect(actions.querySelectorAll('button')).toHaveLength(2);
      expect(actions.querySelector('button[type="submit"]').disabled).toBe(false);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous });
    }
  },
);
