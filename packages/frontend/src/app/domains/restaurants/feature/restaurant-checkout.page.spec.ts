import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { Component, input, output, signal } from '@angular/core';
import { RestaurantCheckoutVisitComponent } from './restaurant-checkout-visit.component';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
@Component({ selector: 'liass-checkout-visit', template: '<h2>Visite sélectionnée</h2>' })
class VisitPresentationStub {
  readonly ctx = input.required<ServiceOrderContext>();
  readonly closed = output<void>();
  readonly accessDenied = output<void>();
}
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { RestaurantCheckoutPage } from './restaurant-checkout.page';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { rid } from '../data-access/restaurants.test-fixture';
import { floorFixture } from '../data-access/service-floor.test-fixture';
import fr from '../../../../../public/assets/i18n/fr.json';
const org = signal('org'),
  user = signal('cashier'),
  revision = signal(1),
  role = signal('CASHIER');
describe('Cashier occupied-table discovery and context', () => {
  let client: QueryClient;
  const api = { myOutlets: vi.fn(), serviceFloor: vi.fn(), list: vi.fn() };
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetAllMocks();
    org.set('org');
    user.set('cashier');
    revision.set(1);
    role.set('CASHIER');
    api.myOutlets.mockResolvedValue({ items: [{ outletId: rid(2), name: 'Restaurant jardin' }] });
    api.serviceFloor.mockResolvedValue(floorFixture());
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantCheckoutPage,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            effectiveOrgId: org,
            currentUserId: user,
            contextRevision: revision,
            activeWorkspaceType: () => 'COMPANY',
            activeWorkspace: () => ({ orgId: org(), productRoles: { RESTAURANTS: role() } }),
          },
        },
        { provide: RestaurantAccessState, useValue: { mode: () => 'checkout' } },
        { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
        { provide: RestaurantsApi, useValue: api },
        { provide: QueryClient, useValue: client },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  const create = () => {
    TestBed.inject(RestaurantOutletContext).setRouteActive(true);
    const fixture = TestBed.createComponent(RestaurantCheckoutPage);
    fixture.detectChanges();
    return fixture;
  };
  it('performance: two cold reads including discovery and zero fresh remount reads', async () => {
    const first = create();
    await vi.waitFor(() => {
      first.detectChanges();
      expect(first.componentInstance.floor.isSuccess()).toBe(true);
    });
    expect(api.myOutlets).toHaveBeenCalledTimes(1);
    expect(api.serviceFloor).toHaveBeenCalledTimes(1);
    first.destroy();
    const second = create();
    await new Promise((resolve) => setTimeout(resolve, 20));
    second.detectChanges();
    expect(api.myOutlets).toHaveBeenCalledTimes(1);
    expect(api.serviceFloor).toHaveBeenCalledTimes(1);
    expect(second.componentInstance.occupied().length).toBeGreaterThan(0);
    second.destroy();
  });
  it('auto-selects one assigned outlet, reuses floor query and filters occupied locally', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(api.serviceFloor).toHaveBeenCalledTimes(1);
    });
    expect(fixture.componentInstance.outletId()).toBe(rid(2));
    expect(api.list).not.toHaveBeenCalled();
    expect(fixture.componentInstance.occupied().every((row) => row.state === 'OCCUPIED')).toBe(
      true,
    );
    fixture.componentInstance.search.set('not present');
    fixture.detectChanges();
    expect(fixture.componentInstance.occupied()).toEqual([]);
    expect(api.serviceFloor).toHaveBeenCalledTimes(1);
  });
  it('keeps zero assignments truthful without floor or configuration fan-out', async () => {
    api.myOutlets.mockResolvedValue({ items: [] });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Aucun établissement actif');
    });
    expect(api.serviceFloor).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });
  it('requires selection for multiple outlets', async () => {
    api.myOutlets.mockResolvedValue({
      items: [
        { outletId: rid(2), name: 'Jardin' },
        { outletId: rid(12), name: 'Centre' },
      ],
    });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.outletOptions()).toHaveLength(2);
    });
    expect(fixture.componentInstance.outletId()).toBe('');
    expect(api.serviceFloor).not.toHaveBeenCalled();
  });
  it('does not auto-select a partial outlet page as the only assignment', async () => {
    api.myOutlets.mockResolvedValue({
      items: [{ outletId: rid(2), name: 'Jardin' }],
      nextCursor: 'more',
    });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.outletOptions()).toHaveLength(1);
    });
    expect(fixture.componentInstance.outletId()).toBe('');
  });
  it('clears selected visit immediately on principal/context change', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.outletId()).toBe(rid(2));
    });
    fixture.componentInstance.sessionId.set(rid(9));
    user.set('other-cashier');
    revision.set(2);
    fixture.detectChanges();
    expect(fixture.componentInstance.sessionId()).toBe('');
    expect(fixture.componentInstance.selectedContext()).toEqual([]);
  });
  it('hides cached floor context and refuses stale selection after outlet access is rejected', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(api.serviceFloor).toHaveBeenCalledTimes(1);
    });
    api.serviceFloor.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    await fixture.componentInstance.floor.refetch();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.allowed()).toBe(false);
    });
    fixture.componentInstance.sessionId.set(rid(9));
    expect(fixture.componentInstance.occupied()).toEqual([]);
    expect(fixture.componentInstance.selectedContext()).toEqual([]);
  });

  it('hides all cached checkout data when the selected visit reports revoked access', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.outletId()).toBe(rid(2));
    });
    fixture.componentInstance.denyCheckout();
    fixture.detectChanges();
    expect(fixture.componentInstance.allowed()).toBe(false);
    expect(fixture.componentInstance.selectedContext()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Restaurant jardin');
    expect(fixture.nativeElement.textContent).toContain('accès à la caisse');
  });
  it('returns keyboard focus to discovery search after successful table release', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.outletId()).toBe(rid(2));
    });
    fixture.componentInstance.released();
    fixture.detectChanges();
    const search = [...fixture.nativeElement.querySelectorAll('input')].at(-1);
    expect(document.activeElement).toBe(search);
  });
  it.each(['OWNER', 'MANAGER'])(
    '%s uses management discovery and a configuration zero state, never Staff assignments',
    async (productRole) => {
      role.set(productRole);
      api.list.mockResolvedValue({ items: [] });
      const fixture = create();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain(
          'Aucun établissement actif n’est configuré',
        );
      });
      expect(api.myOutlets).not.toHaveBeenCalled();
      expect(api.list).toHaveBeenCalledWith('org', 'outlet', {}, undefined);
      expect(api.serviceFloor).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).not.toContain('ne vous est affecté');
    },
  );
  it('retains post-close receipt action independently from table discovery', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = create();
    const ctx = { org: 'org', user: 'cashier', revision: 1, outlet: rid(2), session: rid(9) };
    fixture.componentInstance.released(ctx);
    expect(fixture.componentInstance.sessionId()).toBe('');
    expect(fixture.componentInstance.message()).toContain('Table clôturée');
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.closedVisit()).toEqual(ctx);
    fixture.componentInstance.openReceipt(ctx);
    expect(navigate).toHaveBeenCalledWith(
      ['/restaurants/outlets', rid(2), 'sessions', rid(9), 'receipt'],
      { state: { checkoutClosed: true } },
    );
  });
  it('groups occupied-table search and rows, with intentional detail guidance and contextual currency', async () => {
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.occupied()).toHaveLength(1);
    });
    const master = fixture.nativeElement.querySelector('.checkout-master');
    expect(master.textContent).toContain('Tables occupées');
    expect(master.textContent).toContain('Rechercher une table');
    expect(master.querySelector('input[type="search"]')).not.toBeNull();
    expect(master.textContent).not.toContain('Addition ·');
    expect(master.textContent.match(/XOF/g) ?? []).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('[data-testid="checkout-detail-empty"]').textContent,
    ).toContain('Sélectionnez une table');
  });
  it('returns to the master without recreating the selected detail or discarding its retry state', async () => {
    TestBed.overrideComponent(RestaurantCheckoutPage, {
      remove: { imports: [RestaurantCheckoutVisitComponent] },
      add: { imports: [VisitPresentationStub] },
    });
    const fixture = create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.occupied()).toHaveLength(1);
    });
    const row = fixture.nativeElement.querySelector('.checkout-visit-row') as HTMLButtonElement;
    row.click();
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('liass-checkout-visit');
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.textContent).toContain('check_circle');
    expect(fixture.componentInstance.detailVisible()).toBe(true);
    fixture.componentInstance.showTables();
    fixture.detectChanges();
    expect(fixture.componentInstance.detailVisible()).toBe(false);
    expect(fixture.componentInstance.sessionId()).toBe(rid(9));
    expect(fixture.nativeElement.querySelector('liass-checkout-visit')).toBe(detail);
    row.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('liass-checkout-visit')).toBe(detail);
    expect(api.serviceFloor).toHaveBeenCalledTimes(1);
  });
});
