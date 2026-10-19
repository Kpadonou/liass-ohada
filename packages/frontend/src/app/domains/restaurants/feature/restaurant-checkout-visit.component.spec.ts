import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantCheckoutVisitComponent } from './restaurant-checkout-visit.component';
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
  const flow = { pendingClosure: vi.fn(), close: vi.fn() };
  const sessions = { guestSession: vi.fn() },
    orders = { assertContext: vi.fn(), orders: vi.fn(), items: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
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
        { provide: QueryClient, useValue: client },
        { provide: RestaurantsApi, useValue: sessions },
        { provide: RestaurantOrdersApi, useValue: orders },
        { provide: RestaurantCheckoutFlow, useValue: flow },
        {
          provide: RestaurantsCapabilities,
          useValue: { canCapturePayment: () => true, canCloseCheckout: () => true },
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
    expect(pay.disabled).toBe(true);
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
});
