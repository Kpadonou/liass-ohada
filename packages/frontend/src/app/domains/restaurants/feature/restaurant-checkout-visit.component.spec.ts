import { provideRouter } from '@angular/router';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantCheckoutVisitComponent } from './restaurant-checkout-visit.component';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantOrdersApi } from '../data-access/restaurant-orders.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantCheckoutFlow } from '../data-access/restaurant-checkout-flow';
import { AuthStore } from '../../identity/data-access/auth.store';
import { sessionFixture } from '../data-access/responsible-staff.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import fr from '../../../../../public/assets/i18n/fr.json';
const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
const visit = sessionFixture({
  orderCount: 1,
  openOrderCount: 1,
  dueMinor: 20000,
  paidMinor: 20000,
  tableName: 'Terrasse jardin',
});
const order = {
  orderId: rid(100),
  orgId: 'org',
  outletId: rid(2),
  guestSessionId: rid(9),
  currency: 'XOF',
  status: 'SUBMITTED',
  version: 1,
  createdAt: '2026-10-19T10:00:00Z',
  acceptedLineCount: 1,
  draftLineCount: 0,
  dueMinor: 20000,
  paidMinor: 20000,
  reservedMinor: 0,
  pendingPaymentCount: 0,
  outstandingWorkCount: 0,
};
describe('Checkout canonical reconciliation and terminal state', () => {
  let client: QueryClient;
  let cashDay: { data: null | { businessDayId: string; status: string } };
  let cashSession: { data: null | { businessDayId: string; status: string } };
  let management = false;
  let cashFailure = false;
  let cashPending = false;
  const cashContext = { ...ctx, identity: 'access' };
  const cash = {
    context: () => cashContext,
    day: () => ({
      queryKey: ['cash-test-day'],
      staleTime: 30000,
      retry: false,
      queryFn: async () => {
        if (cashFailure) throw new HttpErrorResponse({ status: 503 });
        if (cashPending) return await new Promise<typeof cashDay>(() => {});
        return cashDay;
      },
    }),
    current: () => ({
      queryKey: ['cash-test-session'],
      staleTime: 30000,
      retry: false,
      queryFn: async () => cashSession,
    }),
  };
  const flow = { pendingClosure: vi.fn(), close: vi.fn() };
  const sessions = { guestSession: vi.fn() },
    orders = { assertContext: vi.fn(), orders: vi.fn(), items: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    cashDay = { data: { businessDayId: rid(20), status: 'OPEN' } };
    cashSession = { data: { businessDayId: rid(20), status: 'OPEN' } };
    management = false;
    cashFailure = false;
    cashPending = false;
    flow.pendingClosure.mockReturnValue(false);
    sessions.guestSession.mockResolvedValue(visit);
    orders.orders.mockResolvedValue({ items: [order] });
    orders.items.mockResolvedValue({ items: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantCheckoutVisitComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: RestaurantCashQueries, useValue: cash },
        { provide: QueryClient, useValue: client },
        { provide: RestaurantsApi, useValue: sessions },
        { provide: RestaurantOrdersApi, useValue: orders },
        { provide: RestaurantCheckoutFlow, useValue: flow },
        {
          provide: RestaurantsCapabilities,
          useValue: {
            canCapturePayment: () => true,
            canCloseCheckout: () => true,
            canManageSetup: () => management,
          },
        },
        {
          provide: AuthStore,
          useValue: { effectiveOrgId: () => 'org', currentUserId: () => 'cashier' },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  const create = () => {
    const fixture = TestBed.createComponent(RestaurantCheckoutVisitComponent);
    fixture.componentRef.setInput('ctx', ctx);
    fixture.detectChanges();
    return fixture;
  };
  it('keeps authorized header DOM during ordinary background reconciliation', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h2')?.textContent).toContain('Terrasse jardin');
    });
    const header = fixture.nativeElement.querySelector('h2');
    let done!: (value: unknown) => void;
    sessions.guestSession.mockReturnValue(new Promise((resolve) => (done = resolve)));
    const pending = fixture.componentInstance.session.refetch();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2')).toBe(header);
    expect(fixture.nativeElement.textContent).not.toContain('Enregistrement en cours');
    done(visit);
    await pending;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2')).toBe(header);
  });
  it('hides cached operational content after an authorization rejection', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h2')).toBeTruthy();
    });
    sessions.guestSession.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    await fixture.componentInstance.session.refetch();
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h2')).toBeNull();
    });
    expect(fixture.nativeElement.textContent).not.toContain('Terrasse jardin');
  });
  it('does not retain closure eligibility after a canonical CLOSED response', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toEqual([]);
    });
    sessions.guestSession.mockResolvedValue({ ...visit, status: 'CLOSED', openOrderCount: 0 });
    await fixture.componentInstance.session.refetch();
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toContain('CLOSED');
    });
    const pay = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'Encaisser',
    ) as HTMLButtonElement;
    expect(pay).toBeUndefined();
  });
  it('promotes explicit Close only after prepared work is served and canonical reads reconcile', async () => {
    orders.orders.mockResolvedValue({ items: [{ ...order, outstandingWorkCount: 1 }] });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toContain('WORK');
    });
    expect(fixture.nativeElement.querySelector('[data-testid="ready-to-close"]')).toBeNull();
    orders.orders.mockResolvedValue({ items: [order] });
    await fixture.componentInstance.refresh();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.readyToClose()).toBe(true);
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="ready-to-close"]')?.textContent,
    ).toContain('Prête à clôturer');
    expect(flow.close).not.toHaveBeenCalled();
  });
  it('shows preparation and draft blockers without any Kitchen query', async () => {
    orders.orders.mockResolvedValue({
      items: [{ ...order, outstandingWorkCount: 1, draftLineCount: 1 }],
    });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toEqual(['DRAFT', 'WORK']);
    });
    expect(fixture.nativeElement.textContent).toContain('préparation ou le service');
  });
  it('never performs OPEN-session reconciliation after an ambiguous final close, then accepts replay', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toEqual([]);
    });
    sessions.guestSession.mockClear();
    orders.orders.mockClear();
    flow.pendingClosure.mockReturnValue(true);
    flow.close.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    await fixture.componentInstance.close();
    expect(sessions.guestSession).not.toHaveBeenCalled();
    expect(orders.orders).not.toHaveBeenCalled();
    const released = vi.spyOn(fixture.componentInstance.closed, 'emit');
    flow.close.mockImplementationOnce(async () => {
      flow.pendingClosure.mockReturnValue(false);
      return { ...visit, status: 'CLOSED' };
    });
    await fixture.componentInstance.close();
    expect(released).toHaveBeenCalledTimes(1);
    expect(sessions.guestSession).not.toHaveBeenCalled();
  });

  it('keeps the receipt handoff after canonical Close even when floor reconciliation rejects', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toEqual([]);
    });
    const released = vi.spyOn(fixture.componentInstance.closed, 'emit');
    flow.close.mockResolvedValue({ ...visit, status: 'CLOSED' });
    vi.spyOn(TestBed.inject(RestaurantsQueries), 'floorChanged').mockRejectedValueOnce(
      new Error('floor unavailable'),
    );
    await fixture.componentInstance.close();
    expect(released).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.error()).toBe('');
  });

  it('does not restore cached checkout from a late session response after Order access is revoked', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.blockers()).toEqual([]);
    });
    orders.orders.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    await fixture.componentInstance.orders.refetch();
    await vi.waitFor(() => expect(fixture.componentInstance.accessRejected()).toBe(true));
    sessions.guestSession.mockResolvedValue(visit);
    await fixture.componentInstance.session.refetch();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.readableSession()).toBeUndefined();
    });
    await fixture.componentInstance.pay();
    await fixture.componentInstance.close();
    expect(flow.close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('h2')).toBeNull();
  });
  it.each(['OWNER', 'MANAGER', 'CASHIER'])(
    'no day: %s sees appropriate guidance and payment is unavailable',
    async (role) => {
      management = role !== 'CASHIER';
      cashDay = { data: null };
      sessions.guestSession.mockResolvedValue({ ...visit, paidMinor: 0 });
      orders.orders.mockResolvedValue({ items: [{ ...order, paidMinor: 0 }] });
      const fixture = create();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.componentInstance.cashState()).toBe('NO_DAY');
        expect(fixture.nativeElement.textContent).toContain('La journée');
      });
      expect(fixture.nativeElement.textContent.includes('Ouvrir la journée')).toBe(management);
      if (!management)
        expect(fixture.nativeElement.textContent).toContain('Contactez un responsable');
    },
  );
  it('no session exposes the own-session opening action', async () => {
    cashSession = { data: null };
    sessions.guestSession.mockResolvedValue({ ...visit, paidMinor: 0 });
    orders.orders.mockResolvedValue({ items: [{ ...order, paidMinor: 0 }] });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.cashState()).toBe('NO_SESSION');
      expect(fixture.nativeElement.textContent).toContain('Ouvrir ma caisse');
    });
  });
  it('valid cached context becomes ready and survives background fetching', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.cashState()).toBe('READY');
    });
    let resolve!: (value: typeof cashDay) => void;
    const pending = client.fetchQuery({
      queryKey: ['cash-test-day'],
      staleTime: 0,
      queryFn: () => new Promise<typeof cashDay>((r) => (resolve = r)),
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.cashState()).toBe('READY');
    resolve(cashDay);
    await pending;
  });

  it('loading cash context keeps payment unavailable', () => {
    cashPending = true;
    const fixture = create();
    expect(fixture.componentInstance.cashState()).toBe('LOADING');
  });
  it('cash context failure exposes the error state', async () => {
    cashFailure = true;
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.cashState()).toBe('ERROR');
    });
  });
  it('a changed Outlet immediately fences the old ready context', async () => {
    const fixture = create();
    await vi.waitFor(() => expect(fixture.componentInstance.cashState()).toBe('READY'));
    fixture.componentRef.setInput('ctx', { ...ctx, outlet: rid(80) });
    fixture.detectChanges();
    expect(fixture.componentInstance.cashState()).toBe('CHANGED');
  });
});
