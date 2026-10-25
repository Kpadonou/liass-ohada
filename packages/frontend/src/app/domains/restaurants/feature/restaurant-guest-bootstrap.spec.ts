import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import { guestInterceptor } from '../../../core/http/guest.interceptor';
import { RestaurantGuestPage } from './restaurant-guest.page';
import { guestStorageKey, writeGuest } from '../data-access/restaurant-guest-storage';
import { RestaurantGuestCartStore } from '../data-access/restaurant-guest-cart.store';

describe('Guest first load through the public HTTP boundary', () => {
  const token = 'A'.repeat(43);
  const capability = 'header..iv.' + 'c'.repeat(150) + '.tag';
  const context = () => ({
    state: 'FREE' as const,
    visitRef: null,
    restaurantName: 'Bistro',
    outletName: 'Centre',
    tableName: 'Jardin',
    policy: 'DIRECT' as const,
    orderingPermitted: true,
    waiterCallAvailable: true as const,
    guestHandle: 'a'.repeat(22),
    capability,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  });
  let fixture: ComponentFixture<RestaurantGuestPage>;
  let http: HttpTestingController;
  let client: QueryClient;
  let key: string;
  beforeEach(async () => {
    sessionStorage.clear();
    key = await guestStorageKey(token);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
        provideHttpClient(withInterceptors([guestInterceptor])),
        provideHttpClientTesting(),
        { provide: QueryClient, useValue: client },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ opaqueTableToken: token })),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    fixture?.destroy();
    client.clear();
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
      sessionStorage.clear();
    }
  });
  function mount() {
    fixture = TestBed.createComponent(RestaurantGuestPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Réessayer');
  }
  const pending = (suffix: string) =>
    vi.waitFor(() => {
      fixture.detectChanges();
      return http.expectOne((r) => r.url.endsWith(suffix));
    });
  function save() {
    const { guestHandle, capability, expiresAt } = context();
    writeGuest(key, { guestHandle, capability, expiresAt });
  }
  async function rendered() {
    (await pending('/state')).flush({ state: 'READY', requests: [] });
    (await pending('/carte')).flush({ state: 'NO_MENU' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Jardin');
      expect(fixture.nativeElement.textContent).not.toContain('Réessayer');
    });
  }
  it('fresh QR renders directly with one resolve and no renewal', async () => {
    mount();
    (await pending('/resolve')).flush(context());
    await rendered();
    http.expectNone((r) => r.url.endsWith('/renew') || r.url.endsWith('/resolve'));
  });
  it('valid stored context renews once and renders directly', async () => {
    save();
    mount();
    (await pending('/renew')).flush(context());
    await rendered();
    http.expectNone((r) => r.url.endsWith('/resolve') || r.url.endsWith('/renew'));
  });
  it('keeps loading while expired stored proof is silently re-resolved', async () => {
    save();
    mount();
    (await pending('/renew')).flush({ state: 'EXPIRED' });
    const resolve = await pending('/resolve');
    expect(resolve.request.body).toEqual({ token, previousCapability: capability });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Réessayer');
    expect(fixture.nativeElement.querySelector('liass-restaurant-guest-carte')).toBeNull();
    resolve.flush(context());
    await rendered();
  });
  it('recovers an expiry during initial Carte loading instead of requiring a fresh manual entry', async () => {
    save();
    mount();
    // FREE renewal is bounded by the original ten-minute entry lifetime.
    (await pending('/renew')).flush({
      ...context(),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    });
    (await pending('/state')).flush({ state: 'READY', requests: [] });
    (await pending('/carte')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush({ state: 'EXPIRED' });
    const resolve = await pending('/resolve');
    expect(resolve.request.body).toEqual({ token, previousCapability: capability });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Réessayer');
    resolve.flush({ ...context(), capability: capability.replace('header', 'renewed') });
    (await pending('/carte')).flush({ state: 'NO_MENU' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Jardin');
      expect(fixture.componentInstance.context()?.guestHandle).toBe('a'.repeat(22));
    });
  });
  it('shares one recovery between simultaneous initial Carte and own-state reads', async () => {
    mount();
    (await pending('/resolve')).flush(context());
    (await pending('/state')).flush({ state: 'EXPIRED' });
    (await pending('/carte')).flush({ state: 'EXPIRED' });
    (await pending('/renew')).flush(context());
    await rendered();
    http.expectNone((r) => r.url.endsWith('/renew') || r.url.endsWith('/resolve'));
  });
  it('preserves the Cart and handle when stale FREE proof resolves to the current service', async () => {
    const cart = TestBed.inject(RestaurantGuestCartStore);
    cart.activate(key, context());
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
    const intent = cart.lines().map(({ name, quantity, note }) => ({ name, quantity, note }));
    save();
    mount();
    (await pending('/renew')).flush({ state: 'EXPIRED' });
    (await pending('/resolve')).flush({
      ...context(),
      state: 'OCCUPIED',
      visitRef: 'v'.repeat(43),
    });
    await rendered();
    expect(cart.lines().map(({ name, quantity, note }) => ({ name, quantity, note }))).toEqual(
      intent,
    );
    expect(fixture.componentInstance.context()?.guestHandle).toBe(context().guestHandle);
  });
  it('does not discard occupied proof to enter an unrelated service', async () => {
    save();
    mount();
    (await pending('/renew')).flush({ state: 'EXPIRED' });
    const resolve = await pending('/resolve');
    expect(resolve.request.body.previousCapability).toBe(capability);
    resolve.flush({ state: 'VISIT_ENDED' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.state()).toBe('VISIT_ENDED');
      expect(fixture.componentInstance.context()).toBeNull();
    });
    http.expectNone((r) => r.url.endsWith('/resolve') || r.url.endsWith('/state'));
  });
  it.each(['revoked QR', 'inactive table', 'inactive outlet', 'disabled ProductAccess'])(
    '%s stays terminal after the public boundary rejects resolution',
    async () => {
      mount();
      (await pending('/resolve')).flush({ state: 'UNAVAILABLE' });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Réessayer');
        expect(fixture.componentInstance.context()).toBeNull();
      });
      http.expectNone((r) => r.url.endsWith('/renew') || r.url.endsWith('/resolve'));
    },
  );
  it('offers manual retry after a genuine network failure and then loads successfully', async () => {
    mount();
    (await pending('/resolve')).flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Réessayer');
    });
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    (await pending('/resolve')).flush(context());
    await rendered();
  });
  it('does not poll after first load', async () => {
    mount();
    (await pending('/resolve')).flush(context());
    await rendered();
    for (const query of client.getQueryCache().getAll())
      expect((query.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
    http.expectNone(() => true);
  });
});
