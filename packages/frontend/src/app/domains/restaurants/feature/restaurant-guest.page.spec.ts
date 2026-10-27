import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantGuestPage } from './restaurant-guest.page';
import { RestaurantGuestCarteApi } from '../data-access/restaurant-guest-carte.queries';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { guestStorageKey, writeGuest } from '../data-access/restaurant-guest-storage';
import { RestaurantGuestCartStore } from '../data-access/restaurant-guest-cart.store';

describe('Guest entry without the staff shell', () => {
  const token = 'A'.repeat(43),
    api = { resolve: vi.fn(), renew: vi.fn(), submissionState: vi.fn() };
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
    api.resolve.mockResolvedValue({ state: 'UNAVAILABLE' });
    api.submissionState.mockResolvedValue({ state: 'READY', requests: [] });
    sessionStorage.clear();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestPage,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
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
    'shows %s context, no staff controls and only authorized Guest features',
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
      expect(
        [...f.nativeElement.querySelectorAll('button')].filter(
          (b: Element) => b.textContent?.trim() === 'Actualiser',
        ),
      ).toHaveLength(1);
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
        expect(f.componentInstance.state()).toBe(state === 'EXPIRED' ? 'UNAVAILABLE' : state);
      });
      if (state === 'VISIT_ENDED') expect(api.resolve).not.toHaveBeenCalled();
      else expect(api.resolve).toHaveBeenCalledExactlyOnceWith(token, 'c'.repeat(100));
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
  it('manual lifecycle refresh reads new service and own request state while preserving Cart', async () => {
    api.resolve.mockResolvedValue(response('FREE'));
    const f = TestBed.createComponent(RestaurantGuestPage);
    f.detectChanges();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.context()?.state).toBe('FREE');
    });
    const cart = TestBed.inject(RestaurantGuestCartStore);
    const key = await guestStorageKey(token);
    cart.activate(key, response('FREE') as never);
    cart.add(
      {
        reference: 'r'.repeat(43),
        selectionRef: 's'.repeat(200),
        name: 'Eau',
        amountMinor: 1000,
        availability: 'AVAILABLE',
      },
      'XOF',
      new Date(Date.now() + 900000).toISOString(),
    );
    const intent = cart.lines().map((l) => ({ name: l.name, quantity: l.quantity, note: l.note }));
    api.renew.mockResolvedValue({ state: 'EXPIRED' });
    api.resolve.mockResolvedValue(response('OCCUPIED'));
    api.submissionState.mockResolvedValue({
      state: 'READY',
      requests: [],
      waiterCall: {
        state: 'ACKNOWLEDGED',
        requestedAt: new Date().toISOString(),
        acknowledgedAt: new Date().toISOString(),
      },
    });
    api.submissionState.mockClear();
    await f.componentInstance.refresh();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.context()?.state).toBe('OCCUPIED');
      expect(api.submissionState).toHaveBeenCalled();
    });
    expect(cart.lines().map((l) => ({ name: l.name, quantity: l.quantity, note: l.note }))).toEqual(
      intent,
    );
    expect(f.nativeElement.textContent).toContain('Actualiser');
    f.destroy();
  });
  it.each(['fr', 'en'])(
    'keeps the menu mounted during a single lifecycle refresh in %s',
    async (language) => {
      TestBed.inject(TranslocoService).setActiveLang(language);
      api.resolve.mockResolvedValue(response('FREE'));
      const fixture = TestBed.createComponent(RestaurantGuestPage);
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.componentInstance.context()?.state).toBe('FREE');
      });
      const menu = fixture.nativeElement.querySelector('liass-restaurant-guest-carte');
      expect(fixture.nativeElement.textContent).toContain(
        language === 'fr' ? 'En attente de prise en charge' : 'Awaiting staff assistance',
      );
      let complete!: (value: unknown) => void;
      api.renew.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const refresh = fixture.componentInstance.refresh();
      await vi.waitFor(() => expect(api.renew).toHaveBeenCalled());
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('liass-restaurant-guest-carte')).toBe(menu);
      expect(fixture.nativeElement.textContent).not.toContain('RESTAURANTS.');
      await fixture.componentInstance.refresh();
      expect(api.renew).toHaveBeenCalledTimes(1);
      complete(response('FREE'));
      await refresh;
      fixture.detectChanges();
      expect(fixture.componentInstance.refreshing()).toBe(false);
      expect(fixture.nativeElement.querySelector('liass-restaurant-guest-carte')).toBe(menu);
      expect(invalidate).toHaveBeenCalledTimes(1);
      const options = invalidate.mock.calls[0][0]!;
      const scope = fixture.componentInstance.scope();
      const matches = options.predicate!;
      expect(matches({ queryKey: ['restaurants-guest', 'carte', scope] } as never)).toBe(true);
      expect(
        matches({ queryKey: ['restaurants-guest', 'submissions', scope + ':guest'] } as never),
      ).toBe(true);
      expect(
        matches({ queryKey: ['restaurants-guest', 'submissions', 'another-scope:guest'] } as never),
      ).toBe(false);
      expect(fixture.nativeElement.textContent).toContain(
        language === 'fr' ? 'Actualiser' : 'Refresh',
      );
    },
  );
  it('places owned order progress before the Carte without adding another refresh control', async () => {
    api.resolve.mockResolvedValue(response('OCCUPIED'));
    api.submissionState.mockResolvedValue({
      state: 'READY',
      requests: [
        {
          requestId: '00000000-0000-4000-8000-000000000001',
          state: 'ACCEPTED',
          orderStatus: 'PREPARING',
          submittedAt: '2026-10-25T16:41:00Z',
          expiresAt: '2026-10-25T16:56:00Z',
          lines: [
            {
              name: 'Poulet',
              quantity: 2,
              fulfillment: 'PREPARING',
              note: '',
              amountMinor: 10000,
              currency: 'XOF',
            },
          ],
        },
      ],
    });
    const fixture = TestBed.createComponent(RestaurantGuestPage);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('article')).toBeTruthy();
    });
    const surfaces = fixture.nativeElement.querySelectorAll(
      'liass-restaurant-guest-submission, liass-restaurant-guest-carte',
    );
    expect(surfaces[0].tagName.toLowerCase()).toBe('liass-restaurant-guest-submission');
    expect(surfaces[0].textContent).toContain('En préparation');
    expect(surfaces[1].tagName.toLowerCase()).toBe('liass-restaurant-guest-carte');
    expect(fixture.nativeElement.querySelectorAll('button[aria-label="Actualiser"]')).toHaveLength(
      1,
    );
  });
  it.each([
    ['fr', 'FREE'],
    ['fr', 'OCCUPIED'],
    ['en', 'FREE'],
    ['en', 'OCCUPIED'],
  ] as const)(
    'renders canonical app-header context and a single accessible refresh in %s / %s',
    async (language, state) => {
      TestBed.inject(TranslocoService).setActiveLang(language);
      const context = response(state);
      api.resolve.mockResolvedValue(context);
      api.renew.mockResolvedValue(context);
      const fixture = TestBed.createComponent(RestaurantGuestPage);
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('header')).toBeTruthy();
      });
      const header = fixture.nativeElement.querySelector('header') as HTMLElement;
      const dictionary = language === 'fr' ? fr : en;
      expect(header.querySelector('h1')?.textContent?.trim()).toBe(context.restaurantName);
      expect(header.textContent).toContain(context.outletName);
      expect(header.textContent).toContain(context.tableName);
      expect(header.textContent).toContain(dictionary.RESTAURANTS.GUEST.WELCOME);
      expect(header.querySelector('[role="status"]')?.textContent).toContain(
        dictionary.RESTAURANTS.GUEST[state === 'FREE' ? 'SERVICE_FREE' : 'SERVICE_OCCUPIED'],
      );
      const refresh = header.querySelector('button') as HTMLButtonElement;
      expect(header.querySelectorAll('button')).toHaveLength(1);
      expect(refresh.getAttribute('aria-label')).toBe(dictionary.RESTAURANTS.GUEST.REFRESH);
      expect(
        fixture.nativeElement.querySelectorAll(
          'button[aria-label="' + dictionary.RESTAURANTS.GUEST.REFRESH + '"]',
        ),
      ).toHaveLength(1);
      refresh.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(api.renew).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.refreshing()).toBe(false);
      });
      expect(api.resolve).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('header')).toBe(header);
    },
  );
  it.each([
    ['Restaurant Les Délices de Cotonou', 'Établissement Haie Vive', 'Terrasse extérieure 12'],
    [
      'Restaurant' + 'A'.repeat(120),
      'Établissement' + 'B'.repeat(100),
      'Terrasse' + 'C'.repeat(100),
    ],
  ])(
    'retains full canonical names and an independently accessible refresh for %s',
    async (restaurantName, outletName, tableName) => {
      api.resolve.mockResolvedValue({
        ...response('OCCUPIED'),
        restaurantName,
        outletName,
        tableName,
      });
      const fixture = TestBed.createComponent(RestaurantGuestPage);
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('header')).toBeTruthy();
      });
      const header = fixture.nativeElement.querySelector('header') as HTMLElement;
      expect(header.querySelector('h1')?.textContent?.trim()).toBe(restaurantName);
      expect(header.textContent).toContain(outletName);
      expect(header.textContent).toContain(tableName);
      expect(header.querySelector('button')?.getAttribute('aria-label')).toBe('Actualiser');
      expect(header.querySelector('[role="status"]')?.textContent).toContain('Service en cours');
    },
  );
});
