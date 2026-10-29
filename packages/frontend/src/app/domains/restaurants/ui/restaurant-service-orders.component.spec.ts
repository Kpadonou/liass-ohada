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
  const api = { assertContext: vi.fn(), items: vi.fn() };
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
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    api.items.mockImplementation(async (_ctx, id) => ({ items: [line(id), line(id, 25, false)] }));
    preparation.page.mockImplementation(async (_ctx, id) => ({
      items: [{ ...serviceTask(22, 'IN_PROGRESS'), orderId: id }],
    }));
    TestBed.configureTestingModule({
      imports: [
        RestaurantServiceOrdersComponent,
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
        lang === 'fr' ? 'Commandes validées' : 'Validated orders',
      );
      expect(f.nativeElement.textContent).not.toContain('private-staff-identifier');
    },
  );
  it('renders no history panel for an empty service or a draft-only canonical Order', () => {
    const f = mount([]);
    expect(f.nativeElement.querySelector('liass-card')).toBeNull();
    f.componentRef.setInput('orders', [
      { ...order(), status: 'DRAFT', acceptedLineCount: 0, dueMinor: 0 },
    ]);
    f.componentRef.setInput('expectedCount', 1);
    f.detectChanges();
    expect(f.nativeElement.querySelector('liass-card')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="service-order"]')).toBeNull();
  });
});
