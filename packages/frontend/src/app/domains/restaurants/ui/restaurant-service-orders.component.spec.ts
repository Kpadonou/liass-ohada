import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { NotificationService } from '../../../core/notifications/notification.service';
import {
  RestaurantItemCancellation,
  acceptedItemCancellable,
} from '../data-access/restaurant-item-cancellation';
import { RestaurantItemCancellationDialog } from '../feature/restaurant-item-cancellation.dialog';
import { RestaurantOrderAbandonmentDialog } from '../feature/restaurant-order-abandonment.dialog';
import { RestaurantOrderAbandonment } from '../data-access/restaurant-order-abandonment';
import { RestaurantOrdersQueries } from '../data-access/restaurant-orders.queries';
import { restaurantKeys } from '../data-access/restaurants.queries';
import { kitchenKeys } from '../data-access/restaurant-preparation.queries';
import { inventoryKeys } from '../data-access/restaurant-inventory.keys';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule, TranslocoService } from '@ngneat/transloco';
import { RestaurantOrderSchema, RestaurantOrderItemSchema } from '@liass-ohada/shared/restaurants';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantServiceOrdersComponent } from './restaurant-service-orders.component';
import { RestaurantOrdersApi } from '../data-access/restaurant-orders.api';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantServicePreparationApi } from '../data-access/restaurant-service-preparation.api';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { rid } from '../data-access/restaurants.test-fixture';
import { serviceContext, serviceTask } from '../data-access/service-preparation.test-fixture';

describe('Canonical Orders across the whole service', () => {
  let client: QueryClient;
  const api = { assertContext: vi.fn(), items: vi.fn(), command: vi.fn(), abandon: vi.fn() };
  let management = false;
  const dialogRef = { close: vi.fn(), disableClose: false };
  const notifications = { success: vi.fn(), error: vi.fn() };
  const preparation = { page: vi.fn() };
  const order = (id = 20) =>
    RestaurantOrderSchema.parse({
      orgId: 'org',
      outletId: rid(2),
      schemaVersion: 1,
      orderId: rid(id),
      guestSessionId: rid(9),
      orderType: 'DINE_IN',
      status: 'SUBMITTED',
      currency: 'XOF',
      createdAt: `2026-10-18T10:${id === 20 ? '00' : '05'}:00.000Z`,
      createdBy: 'guest:' + 'a'.repeat(22),
      version: 1,
      financialRevision: 1,
      lineCount: 2,
      acceptedLineCount: 2,
      draftLineCount: 0,
      dueMinor: 6000,
      paidMinor: 0,
      reservedMinor: 0,
      pendingPaymentCount: 0,
    });
  const line = (orderId: string, item = 21, stationed = true) =>
    RestaurantOrderItemSchema.parse({
      orgId: 'org',
      outletId: rid(2),
      schemaVersion: 1,
      orderId,
      itemId: rid(item),
      menuItemId: rid(7),
      categoryId: rid(6),
      quantity: 2,
      expectedMenuItemVersion: 1,
      version: 1,
      status: 'ACCEPTED',
      createdAt: '2026-10-18T10:00:00.000Z',
      ...(stationed ? { latestFireId: rid(22) } : {}),
      snapshot: {
        menuItemId: rid(7),
        menuId: rid(8),
        categoryId: rid(6),
        itemVersion: 1,
        categoryVersion: 1,
        menuVersion: 1,
        name: stationed ? 'Poulet braisé' : 'Eau FIFA',
        ...(stationed ? { stationId: rid(3), stationVersion: 1 } : {}),
        quantity: 2,
        unitPriceMinor: 1500,
        grossMinor: 3000,
        subtotalMinor: 3000,
        discountMinor: 0,
        taxMinor: 0,
        lineTotalMinor: 3000,
        currency: 'XOF',
        acceptedAt: '2026-10-18T10:01:00.000Z',
        acceptedBy: 'guest:' + 'a'.repeat(22),
        submissionId: rid(40),
      },
    });
  beforeEach(() => {
    vi.resetAllMocks();
    management = false;
    dialogRef.disableClose = false;
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    api.items.mockImplementation(async (_ctx, id) => ({ items: [line(id), line(id, 25, false)] }));
    preparation.page.mockImplementation(async (_ctx, id) => ({
      items: [{ ...serviceTask(22, 'IN_PROGRESS'), orderId: id }],
    }));
    TestBed.configureTestingModule({
      imports: [
        RestaurantServiceOrdersComponent,
        RestaurantItemCancellationDialog,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        { provide: RestaurantsCapabilities, useValue: { canManageSetup: () => management } },
        {
          provide: MAT_DIALOG_DATA,
          useFactory: () => ({ context: serviceContext, order: order(), line: line(rid(20)) }),
        },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: NotificationService, useValue: notifications },
        { provide: QueryClient, useValue: client },
        { provide: RestaurantOrdersApi, useValue: api },
        { provide: RestaurantsApi, useValue: {} },
        { provide: RestaurantServicePreparationApi, useValue: preparation },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  function mount(values = [order()]) {
    const f = TestBed.createComponent(RestaurantServiceOrdersComponent);
    f.componentRef.setInput('context', serviceContext);
    f.componentRef.setInput('orders', values);
    f.componentRef.setInput('expectedCount', values.length);
    f.detectChanges();
    return f;
  }
  it.each([1, 3])(
    'performance: %s visible accepted Orders cost two reads each, fresh remount reuses them',
    async (count) => {
      // Keep realistic default cache lifetime for navigation; other cases deliberately test gcTime=0.
      client.setDefaultOptions({ queries: { retry: false, gcTime: 300000 } });
      const values = Array.from({ length: count }, (_, index) => order(20 + index));
      let f = mount(values);
      await vi.waitFor(() => {
        f.detectChanges();
        expect(api.items).toHaveBeenCalledTimes(count);
        expect(preparation.page).toHaveBeenCalledTimes(count);
      });
      f.destroy();
      f = mount(values);
      await new Promise((resolve) => setTimeout(resolve, 20));
      f.detectChanges();
      expect(api.items).toHaveBeenCalledTimes(count);
      expect(preparation.page).toHaveBeenCalledTimes(count);
      f.destroy();
    },
  );
  it.each(['fr', 'en'])(
    'shows DIRECT canonical lines, amounts and truthful mixed progress in %s',
    async (lang) => {
      TestBed.inject(TranslocoService).setActiveLang(lang);
      const f = mount();
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.nativeElement.querySelectorAll('[data-testid="service-order-line"]')).toHaveLength(
          2,
        );
        expect(f.nativeElement.textContent).toContain(
          lang === 'fr' ? 'En préparation' : 'Preparing',
        );
      });
      const rows = [
        ...f.nativeElement.querySelectorAll('[data-testid="service-order-line"]'),
      ] as HTMLElement[];
      expect(rows[0].textContent).toContain('2 × Poulet braisé');
      expect(rows[1].textContent).toContain('2 × Eau FIFA');
      expect(rows[1].textContent).toContain(lang === 'fr' ? 'Confirmée' : 'Confirmed');
      expect(f.nativeElement.textContent).toContain('QR');
      expect(f.nativeElement.textContent).not.toContain('Aucune commande validée');
      expect(f.nativeElement.textContent).not.toContain(rid(20));
      expect(f.nativeElement.textContent).not.toContain('RESTAURANTS.');
    },
  );
  it('shows multiple Orders independently without requiring an editable Order selection', async () => {
    const f = mount([order(), order(30)]);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelectorAll('[data-testid="service-order-line"]')).toHaveLength(
        4,
      );
    });
    expect(f.nativeElement.querySelectorAll('[data-testid="service-order"]')).toHaveLength(2);
    const times = [...f.nativeElement.querySelectorAll('h3 time')] as HTMLElement[];
    expect(times.map((time) => time.getAttribute('datetime'))).toEqual([
      order().createdAt,
      order(30).createdAt,
    ]);
    expect(api.items.mock.calls.map((call) => call[1])).toEqual([rid(20), rid(30)]);
  });
  it.each(['READY', 'SERVED'] as const)(
    'shows canonical %s progress and leaves no-station items confirmed',
    async (state) => {
      preparation.page.mockResolvedValue({ items: [serviceTask(22, state)] });
      const f = mount();
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.nativeElement.textContent).toContain(
          state === 'READY' ? 'Prête à servir' : 'Servie',
        );
      });
      const water = f.nativeElement.querySelectorAll('[data-testid="service-order-line"]')[1];
      expect(water.textContent).toContain('Confirmée');
    },
  );
  it('never claims an empty service when the canonical session says Orders exist', () => {
    const f = mount([]);
    f.componentRef.setInput('expectedCount', 2);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('La liste est incomplète');
    expect(f.nativeElement.textContent).not.toContain('Aucune commande');
  });
  it('does not invent progress when canonical preparation is absent', async () => {
    preparation.page.mockResolvedValue({ items: [] });
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Progression à actualiser');
    });
    expect(f.nativeElement.textContent).not.toContain('En préparation');
  });
  it('shows an incomplete read rather than empty Orders when the canonical amount is non-zero', () => {
    const f = mount([]);
    f.componentRef.setInput('expectedAmount', 320800);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('La liste est incomplète');
    expect(f.nativeElement.textContent).not.toContain('Aucune commande');
  });
  it('hides protected order details and signals lost authorization', async () => {
    api.items.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    const f = mount();
    const denied = vi.fn();
    f.componentInstance.denied.subscribe(denied);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(denied).toHaveBeenCalled();
    });
    expect(f.nativeElement.querySelector('[data-testid="service-order"]')).toBeNull();
  });
  it.each(['fr', 'en'])(
    'keeps distinct canonical totals and Client (QR) / Staff sources in %s',
    async (lang) => {
      TestBed.inject(TranslocoService).setActiveLang(lang);
      const f = mount([order(), { ...order(30), createdBy: 'private-staff-identifier' }]);
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.nativeElement.querySelectorAll('[data-testid="service-order-line"]')).toHaveLength(
          4,
        );
      });
      const cards = f.nativeElement.querySelectorAll('[data-testid="service-order"]');
      expect(cards).toHaveLength(2);
      expect(cards[0].querySelector('[data-testid="order-source"]').textContent.trim()).toBe(
        'Client (QR)',
      );
      expect(cards[1].querySelector('[data-testid="order-source"]').textContent.trim()).toBe(
        'Staff',
      );
      for (const card of cards)
        expect(card.textContent).toContain(restaurantOperationalPrice(6000, 'XOF', lang));
      expect(f.nativeElement.textContent).toContain(
        lang === 'fr' ? 'Commandes du service' : 'Service orders',
      );
      expect(f.nativeElement.textContent).not.toContain('private-staff-identifier');
    },
  );
  it('keeps another unmarked draft visible but suppresses the identified local draft', () => {
    const f = mount([]);
    expect(f.nativeElement.querySelector('liass-card')).toBeNull();
    f.componentRef.setInput('orders', [
      { ...order(), status: 'DRAFT', acceptedLineCount: 0, dueMinor: 0 },
    ]);
    f.componentRef.setInput('expectedCount', 1);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="service-order"]')).not.toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
    f.componentRef.setInput('activeDraftOrderId', rid(20));
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="service-order"]')).toBeNull();
  });
  it.each(['OWNER', 'MANAGER'])(
    'offers Order abandonment for %s even with accepted lines, independently of item action',
    async () => {
      management = true;
      const open = vi
        .spyOn(TestBed.inject(MatDialog), 'open')
        .mockReturnValue({ close: vi.fn(), afterClosed: () => of(undefined) } as never);
      const f = mount();
      await vi.waitFor(() => {
        f.detectChanges();
        expect(
          f.nativeElement.querySelector('[data-testid="abandon-order"] button'),
        ).not.toBeNull();
      });
      const button = f.nativeElement.querySelector('[data-testid="abandon-order"] button');
      expect(button.closest('[data-testid="service-order-line"]')).toBeNull();
      button.click();
      expect(open).toHaveBeenCalledWith(
        RestaurantOrderAbandonmentDialog,
        expect.objectContaining({
          maxWidth: 'calc(100vw - 32px)',
          disableClose: true,
          data: expect.objectContaining({ context: serviceContext, order: order() }),
        }),
      );
    },
  );
  it('keeps empty draft Order reachable for management, and terminal Order history without abandonment', async () => {
    management = true;
    api.items.mockResolvedValue({ items: [] });
    const empty = { ...order(), status: 'DRAFT' as const, acceptedLineCount: 0, dueMinor: 0 };
    const f = mount([empty]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
    f.componentRef.setInput('orders', [{ ...empty, status: 'CANCELLED' }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
    expect(f.nativeElement.textContent).toContain('Commande annulée');
    f.componentRef.setInput('orders', [{ ...empty, status: 'CLOSED' }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
  });
  it('does not expose Order abandonment to a non-management operator', () => {
    const f = mount();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
  });
  it.each(['DRAFT'] as const)(
    'hides Order cancellation while %s contains draft lines',
    (status) => {
      management = true;
      const f = mount([{ ...order(), status, draftLineCount: 1 }]);
      expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
    },
  );
  it('does not render an action without a persisted Order', () => {
    management = true;
    const f = mount([]);
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
  });
  it('suppresses only the composing DRAFT card and never hides a submitted Order', () => {
    management = true;
    const draft = { ...order(), status: 'DRAFT' as const, acceptedLineCount: 0, dueMinor: 0 };
    const sibling = order(30);
    const f = mount([draft, sibling]);
    f.componentRef.setInput('activeDraftOrderId', draft.orderId);
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('[data-testid="service-order"]')).toHaveLength(1);
    expect(f.nativeElement.querySelectorAll('[data-testid="abandon-order"]')).toHaveLength(1);
    f.componentRef.setInput('activeDraftOrderId', sibling.orderId);
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('[data-testid="service-order"]')).toHaveLength(2);
    expect(f.nativeElement.querySelectorAll('[data-testid="abandon-order"]')).toHaveLength(0);
    f.componentRef.setInput('activeDraftOrderId', '');
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('[data-testid="abandon-order"]')).toHaveLength(1);
  });
  it('uses the local active workflow, not a duplicated server guard, to hide cancellation during local drafting', async () => {
    management = true;
    api.items.mockResolvedValue({
      items: [{ ...line(rid(20)), status: 'DRAFT', snapshot: undefined }],
    });
    const f = mount();
    f.componentRef.setInput('activeDraftOrderId', rid(20));
    await vi.waitFor(() => {
      f.detectChanges();
      expect(api.items).toHaveBeenCalled();
      expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
    });
  });
  it('hides only canonically technical Orders while preserving business-cancelled and unmarked legacy history', () => {
    const technical = {
      ...order(),
      status: 'CANCELLED' as const,
      resolutionKind: 'TECHNICAL_EMPTY_DRAFT' as const,
    };
    const business = {
      ...order(30),
      status: 'CANCELLED' as const,
      resolutionKind: 'BUSINESS' as const,
    };
    const legacy = {
      ...order(40),
      status: 'CANCELLED' as const,
      acceptedLineCount: 0,
      dueMinor: 0,
    };
    const f = mount([technical, business, legacy]);
    expect(f.nativeElement.querySelectorAll('[data-testid="service-order"]')).toHaveLength(2);
    expect(f.componentInstance.orders()).toHaveLength(3);
    expect(f.nativeElement.textContent).not.toContain('La liste est incomplète');
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
  });
  it.each([
    ['fr', 'Annuler la commande'],
    ['en', 'Cancel order'],
  ])('uses the accepted %s Order action label', (lang, label) => {
    management = true;
    TestBed.inject(TranslocoService).setActiveLang(lang);
    const f = mount();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]').textContent).toContain(
      label,
    );
  });
  it('keeps an ambiguous intent reachable as retry after a terminal canonical refresh', async () => {
    management = true;
    api.abandon.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    await expect(
      TestBed.inject(RestaurantOrderAbandonment).abandon(serviceContext, order(), 'Reason'),
    ).rejects.toThrow();
    const f = mount([{ ...order(), status: 'CANCELLED' }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="abandon-order"]')).toBeNull();
    expect(
      f.nativeElement.querySelector('[data-testid="retry-abandon-order"] button'),
    ).not.toBeNull();
    expect(f.nativeElement.textContent).toContain('Réessayer la même annulation');
  });
  const cancelled = () => ({
    ...line(rid(20)),
    status: 'CANCELLED' as const,
    version: 2,
    cancelledAt: '2026-11-02T10:00:00.000Z',
    cancelledBy: 'manager',
    cancellationReason: 'Wrong selection',
  });
  it('shows the single accessible management action only for eligible accepted lines', async () => {
    management = true;
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelectorAll('[data-testid="cancel-accepted-item"]')).toHaveLength(
        2,
      );
    });
    const button = f.nativeElement.querySelector('[data-testid="cancel-accepted-item"] button');
    expect(button.getAttribute('aria-label')).toBe('Annuler l’article');
    const open = vi
      .spyOn(TestBed.inject(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(undefined), close: vi.fn() } as never);
    button.click();
    expect(open).toHaveBeenCalledWith(
      RestaurantItemCancellationDialog,
      expect.objectContaining({
        maxWidth: 'calc(100vw - 32px)',
        data: expect.objectContaining({
          context: serviceContext,
          order: order(),
          line: line(rid(20)),
        }),
      }),
    );
    f.componentRef.setInput('orders', [{ ...order(), paidMinor: 6000 }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="cancel-accepted-item"]')).toBeNull();
  });
  it('does not expose accepted cancellation to a non-management operator', async () => {
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelector('[data-testid="service-order-line"]')).not.toBeNull();
    });
    expect(f.nativeElement.querySelector('[data-testid="cancel-accepted-item"]')).toBeNull();
  });
  it('retains cancelled accepted history, reason and siblings without displaying its old charge as payable', async () => {
    api.items.mockResolvedValue({ items: [cancelled(), line(rid(20), 25, false)] });
    const f = mount([{ ...order(), dueMinor: 3000 }]);
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.querySelectorAll('[data-testid="service-order-line"]')).toHaveLength(
        2,
      );
    });
    const rows = f.nativeElement.querySelectorAll('[data-testid="service-order-line"]');
    expect(rows[0].textContent).toContain('Annulée');
    expect(rows[0].textContent).toContain('Wrong selection');
    expect(rows[0].textContent).not.toContain('Progression à actualiser');
    expect(rows[1].textContent).toContain('Eau FIFA');
    expect(f.nativeElement.textContent).not.toContain('La liste est incomplète');
  });
  it('matches whole-line monetary protection without inventing partial quantities', () => {
    const item = line(rid(20));
    expect(acceptedItemCancellable({ ...order(), paidMinor: 3000 }, item)).toBe(true);
    expect(acceptedItemCancellable({ ...order(), reservedMinor: 3001 }, item)).toBe(false);
    expect(acceptedItemCancellable({ ...order(), paidMinor: 6000 }, item)).toBe(false);
    expect(acceptedItemCancellable({ ...order(), status: 'CLOSED' }, item)).toBe(false);
    expect(acceptedItemCancellable(order(), { ...item, status: 'DRAFT' })).toBe(false);
  });
  it('uses the existing command and versions, replaces only its canonical line and scopes reconciliation', async () => {
    management = true;
    client.setDefaultOptions({ queries: { retry: false, gcTime: 300000 } });
    const queries = TestBed.inject(RestaurantOrdersQueries);
    const flow = TestBed.inject(RestaurantItemCancellation);
    const oldLine = line(rid(20)),
      sibling = line(rid(20), 25, false);
    client.setQueryData(queries.key(serviceContext, 'items', rid(20)), {
      pages: [{ items: [oldLine, sibling] }],
      pageParams: [undefined],
    });
    const other = restaurantKeys.session('foreign', rid(2), rid(9));
    client.setQueryData(other, { untouched: true });
    const kitchen = kitchenKeys.lane(serviceContext, rid(3), 'IN_PROGRESS');
    client.setQueryData(kitchen, { pages: [{ items: [] }] });
    api.command.mockResolvedValue(cancelled());
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await flow.cancel(serviceContext, order(), oldLine, 'Wrong selection');
    expect(api.command).toHaveBeenCalledWith(
      serviceContext,
      'remove',
      expect.objectContaining({
        expectedVersion: 1,
        expectedItemVersion: 1,
        reason: 'Wrong selection',
        clientRequestId: expect.any(String),
      }),
      rid(20),
      rid(21),
    );
    expect(client.getQueryData(queries.key(serviceContext, 'items', rid(20)))).toMatchObject({
      pages: [{ items: [cancelled(), sibling] }],
    });
    expect(invalidate.mock.calls.map(([v]) => v?.queryKey)).toContainEqual(
      restaurantKeys.session('org', rid(2), rid(9), 'waiter', 1),
    );
    expect(client.getQueryState(queries.key(serviceContext, 'items', rid(20)))?.isInvalidated).toBe(
      false,
    );
    expect(client.getQueryState(kitchen)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(flow.pending(serviceContext, rid(20), rid(21))).toBeUndefined();
  });
  it('marks only current actor/Outlet Inventory stale for potentially tracked non-station lines', async () => {
    management = true;
    client.setDefaultOptions({ queries: { retry: false, gcTime: 300000 } });
    const flow = TestBed.inject(RestaurantItemCancellation);
    const stock = { ...serviceContext, identity: 'operational' };
    const target = inventoryKeys.items(stock),
      other = inventoryKeys.items({ ...stock, outlet: rid(99) });
    client.setQueryData(target, { items: [] });
    client.setQueryData(other, { items: [] });
    const water = line(rid(20), 25, false);
    api.command.mockResolvedValue({
      ...water,
      status: 'CANCELLED',
      cancelledAt: '2026-11-02T10:00:00.000Z',
      cancelledBy: 'manager',
      cancellationReason: 'Wrong selection',
    });
    await flow.cancel(serviceContext, order(), water, 'Wrong selection');
    expect(client.getQueryState(target)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });
  it('preserves the exact ambiguous intent across retry and never sends a second concurrent command', async () => {
    management = true;
    const flow = TestBed.inject(RestaurantItemCancellation);
    let reject!: (e: unknown) => void;
    api.command.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const first = flow.cancel(serviceContext, order(), line(rid(20)), 'Wrong selection');
    const check = expect(first).rejects.toThrow();
    await expect(flow.cancel(serviceContext, order(), line(rid(20)), 'Changed')).rejects.toThrow(
      'pending',
    );
    reject(new HttpErrorResponse({ status: 0 }));
    await check;
    const original = api.command.mock.calls[0][2];
    api.command.mockResolvedValue(cancelled());
    await flow.cancel(serviceContext, order(), line(rid(20)), 'Changed');
    expect(api.command.mock.calls[1][2]).toEqual(original);
    expect(api.command).toHaveBeenCalledTimes(2);
  });
  it('dialog identifies the full accepted line and validates trimmed reason with the shared contract', async () => {
    management = true;
    const f = TestBed.createComponent(RestaurantItemCancellationDialog);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('2 × Poulet braisé');
    expect(f.nativeElement.querySelector('textarea').getAttribute('maxlength')).toBe('500');
    for (const value of ['', '   ', 'x'.repeat(501)]) {
      f.componentInstance.form.controls.reason.setValue(value);
      await f.componentInstance.submit();
      expect(f.componentInstance.form.invalid).toBe(true);
    }
    expect(api.command).not.toHaveBeenCalled();
  });
  it('dialog blocks duplicate submit, waits for confirmation and emits safe success feedback', async () => {
    management = true;
    const f = TestBed.createComponent(RestaurantItemCancellationDialog);
    f.detectChanges();
    f.componentInstance.form.controls.reason.setValue('Wrong selection');
    let finish!: (value: unknown) => void;
    api.command.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = f.componentInstance.submit();
    await vi.waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    await f.componentInstance.submit();
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(dialogRef.disableClose).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();
    finish(cancelled());
    await first;
    expect(dialogRef.close).toHaveBeenCalledWith(cancelled());
    expect(notifications.success).toHaveBeenCalledWith('Article annulé.');
  });
  it('definite domain conflict is visible and requires fresh operator review instead of automatic retry', async () => {
    management = true;
    const f = TestBed.createComponent(RestaurantItemCancellationDialog);
    f.detectChanges();
    api.command.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
    f.componentInstance.form.controls.reason.setValue('Wrong selection');
    await f.componentInstance.submit();
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'La commande a changé',
    );
    expect(f.componentInstance.blocked()).toBe(true);
    await f.componentInstance.submit();
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(notifications.error).toHaveBeenCalled();
  });
  it('ambiguous dialog result locks reason, retains intent on reopen and offers the same retry', async () => {
    management = true;
    let f = TestBed.createComponent(RestaurantItemCancellationDialog);
    f.detectChanges();
    api.command.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    f.componentInstance.form.controls.reason.setValue('Wrong selection');
    await f.componentInstance.submit();
    f.detectChanges();
    expect(f.componentInstance.uncertain()).toBe(true);
    expect(f.componentInstance.form.disabled).toBe(true);
    expect(f.nativeElement.textContent).toContain('Réessayer la même annulation');
    f.destroy();
    f = TestBed.createComponent(RestaurantItemCancellationDialog);
    f.detectChanges();
    expect(f.componentInstance.form.getRawValue().reason).toBe('Wrong selection');
    expect(f.componentInstance.form.disabled).toBe(true);
    api.command.mockResolvedValue(cancelled());
    await f.componentInstance.submit();
    expect(api.command.mock.calls[1][2]).toEqual(api.command.mock.calls[0][2]);
  });

  it.each([1440, 900, 390, 446])(
    'keeps the contextual action reachable with wrapping at %spx (structural)',
    async (width) => {
      const previous = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      try {
        management = true;
        const f = mount();
        await vi.waitFor(() => {
          f.detectChanges();
          expect(
            f.nativeElement.querySelector('[data-testid="cancel-accepted-item"] button'),
          ).not.toBeNull();
        });
        const row = f.nativeElement.querySelector('[data-testid="service-order-line"]');
        const abandon = f.nativeElement.querySelector('[data-testid="abandon-order"] button');
        expect(abandon).not.toBeNull();
        expect(abandon.disabled).toBe(false);
        expect(abandon.closest('[hidden]')).toBeNull();
        expect(abandon.closest('[data-testid="service-order-line"]')).toBeNull();
        expect(row.classList.contains('flex-wrap')).toBe(true);
        expect(row.querySelector('button').disabled).toBe(false);
        expect(row.querySelector('button').closest('[hidden]')).toBeNull();
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous });
      }
    },
  );
  it('rejects locally revoked management and foreign context before sending a command', async () => {
    const flow = TestBed.inject(RestaurantItemCancellation);
    await expect(
      flow.cancel(serviceContext, order(), line(rid(20)), 'Reason'),
    ).rejects.toMatchObject({ status: 403 });
    management = true;
    await expect(
      flow.cancel({ ...serviceContext, session: rid(99) }, order(), line(rid(20)), 'Reason'),
    ).rejects.toThrow('context');
    expect(api.command).not.toHaveBeenCalled();
  });
});
