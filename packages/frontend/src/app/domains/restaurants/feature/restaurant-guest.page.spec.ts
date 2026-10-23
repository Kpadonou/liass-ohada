import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import { RestaurantGuestPage } from './restaurant-guest.page';
import { RestaurantGuestCarteApi } from '../data-access/restaurant-guest-carte.queries';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { guestStorageKey, writeGuest } from '../data-access/restaurant-guest-storage';
import { RestaurantGuestCartStore } from '../data-access/restaurant-guest-cart.store';

describe('Guest entry without the staff shell', () => {
  const token = 'A'.repeat(43),
    api = { resolve: vi.fn(), renew: vi.fn() };
  let client: QueryClient;
  const response = (state: 'FREE' | 'OCCUPIED') => ({
    state,
    visitRef: state === 'OCCUPIED' ? 'v'.repeat(43) : null,
    restaurantName: 'Bistro',
    outletName: 'Centre',
    tableName: 'Table du jardin',
    policy: 'STAFF_APPROVAL',
    orderingPermitted: state === 'OCCUPIED',
    waiterCallAvailable: true,
    guestHandle: 'a'.repeat(22),
    capability: 'c'.repeat(100),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  });
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestPage,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantGuestApi, useValue: api },
        {
          provide: RestaurantGuestCarteApi,
          useValue: { read: vi.fn().mockResolvedValue({ body: { state: 'NO_MENU' } }) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ opaqueTableToken: token })),
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
    sessionStorage.clear();
  });
  it.each(['FREE', 'OCCUPIED'] as const)(
    'shows %s context, no staff controls and no prematurely implemented features',
    async (state) => {
      api.resolve.mockResolvedValue(response(state));
      const f = TestBed.createComponent(RestaurantGuestPage);
      f.detectChanges();
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.nativeElement.textContent).toContain('Table du jardin');
      });
      expect(f.nativeElement.querySelector('liass-app-shell')).toBeNull();
      expect(f.nativeElement.querySelector('nav')).toBeNull();
      expect(f.nativeElement.textContent).not.toContain('Commander');
      expect(f.nativeElement.querySelectorAll('button')).toHaveLength(1);
      expect(sessionStorage.length).toBe(1);
    },
  );
  it.each(['UNAVAILABLE', 'VISIT_ENDED', 'EXPIRED'])(
    'shows safe %s without silently entering another visit',
    async (state) => {
      const key = await guestStorageKey(token);
      writeGuest(key, {
        guestHandle: 'a'.repeat(22),
        capability: 'c'.repeat(100),
        expiresAt: new Date().toISOString(),
      });
      api.renew.mockResolvedValue({ state });
      const f = TestBed.createComponent(RestaurantGuestPage);
      f.detectChanges();
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.componentInstance.request.isSuccess()).toBe(true);
        expect(f.componentInstance.state()).toBe(state);
      });
      expect(api.resolve).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(key)).toBeNull();
    },
  );
  it('marks a visit-bound cart ended when initial renewal returns VISIT_ENDED', async () => {
    const key = await guestStorageKey(token);
    const cart = TestBed.inject(RestaurantGuestCartStore);
    cart.activate(key, response('OCCUPIED') as never);
    cart.add(
      {
        reference: 'public-item-reference',
        selectionRef: 'selection-reference-current',
        name: 'Eau minérale',
        amountMinor: 1000,
        availability: 'AVAILABLE',
      },
      'XOF',
      new Date(Date.now() + 900_000).toISOString(),
    );
    writeGuest(key, {
      guestHandle: 'a'.repeat(22),
      capability: 'c'.repeat(100),
      expiresAt: new Date().toISOString(),
    });
    api.renew.mockResolvedValue({ state: 'VISIT_ENDED' });
    const fixture = TestBed.createComponent(RestaurantGuestPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('VISIT_ENDED'));
    expect(cart.contextStatus()).toBe('VISIT_ENDED');
    expect(cart.lines()).toHaveLength(1);
  });
});
