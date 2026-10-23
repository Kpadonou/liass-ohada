import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import { RestaurantGuestCarteComponent } from './restaurant-guest-carte.component';
import { RestaurantGuestCarteApi } from '../data-access/restaurant-guest-carte.queries';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';

describe('Consumer Guest Carte', () => {
  const read = vi.fn(),
    renew = vi.fn();
  let client: QueryClient;
  const body = {
    state: 'READY',
    currency: 'XOF',
    referencesExpireAt: new Date(Date.now() + 900000).toISOString(),
    categories: [
      {
        reference: 'category-public-ref',
        name: 'Grillades',
        position: 0,
        items: [
          {
            reference: 'item-public-ref',
            selectionRef: 'encrypted-selection',
            name: 'Poulet braisé aux épices douces et son accompagnement de saison',
            amountMinor: 3500,
            availability: 'UNAVAILABLE',
          },
        ],
      },
    ],
  };
  beforeEach(() => {
    vi.resetAllMocks();
    read.mockResolvedValue({ body });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestCarteComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        { provide: QueryClient, useValue: client },
        { provide: RestaurantGuestCarteApi, useValue: { read } },
        { provide: RestaurantGuestApi, useValue: { renew } },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    client.clear();
  });
  function mount(expiresAt = new Date(Date.now() + 600000).toISOString()) {
    const f = TestBed.createComponent(RestaurantGuestCarteComponent);
    f.componentRef.setInput('scope', 'qr-hash');
    f.componentRef.setInput('context', {
      state: 'FREE',
      visitRef: null,
      capability: 'guest-jwe',
      guestHandle: 'a'.repeat(22),
      expiresAt,
    });
    f.detectChanges();
    return f;
  }
  it('renders ordered categories, text-first items, prices and non-color availability with no cart', async () => {
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Poulet braisé');
    });
    expect(f.nativeElement.textContent).toContain('Indisponible');
    expect(f.nativeElement.textContent).toContain('XOF');
    expect(f.nativeElement.querySelector('h1').textContent).toContain('Carte');
    expect(f.nativeElement.querySelector('nav button').getAttribute('aria-pressed')).toBe('false');
    expect(f.nativeElement.textContent).not.toMatch(/Ajouter|Commander|Panier/);
    expect(f.nativeElement.querySelector('table')).toBeNull();
  });
  it('retains canonical cached Carte when revalidation fails', async () => {
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.isSuccess()).toBe(true);
    });
    read.mockRejectedValue(new Error('offline'));
    await f.componentInstance.query.refetch();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.isError()).toBe(true);
    });
    expect(f.nativeElement.textContent).toContain('Poulet braisé');
    expect(f.nativeElement.textContent).toContain('connexion');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('shows contextual initial error and retry', async () => {
    read.mockRejectedValue(new Error('offline'));
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.isError()).toBe(true);
    });
    expect(f.nativeElement.textContent).toContain('Réessayer');
    expect(f.nativeElement.querySelector('[role=alert]')).not.toBeNull();
  });
  it('shows truthful no-menu state', async () => {
    read.mockResolvedValue({ body: { state: 'NO_MENU' } });
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('pas encore disponible');
    });
    expect(f.nativeElement.querySelector('nav')).toBeNull();
  });
  it('renews once then ends an expired context without resolve or retry loop', async () => {
    renew.mockResolvedValue({ state: 'EXPIRED' });
    const f = mount(new Date().toISOString());
    const ended = vi.fn();
    f.componentInstance.ended.subscribe(ended);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('EXPIRED'));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
  it('makes zero additional reads while canonical TanStack data is fresh', async () => {
    const f = mount();
    await vi.waitFor(() => expect(f.componentInstance.query.isSuccess()).toBe(true));
    const key = ['restaurants-guest', 'carte', 'qr-hash', 'a'.repeat(22)] as const;
    const canonical = client.getQueryCache().find({ queryKey: key });
    expect((canonical?.options as { staleTime?: number })?.staleTime).toBe(60_000);
    const accidentalRead = vi.fn();
    await client.fetchInfiniteQuery({
      queryKey: key,
      queryFn: accidentalRead,
      initialPageParam: undefined,
      staleTime: 60_000,
    });
    expect(accidentalRead).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('does not claim an empty menu when only a partial page has been read', async () => {
    read.mockResolvedValue({
      body: { ...body, categories: [], nextCursor: 'opaque-continuation' },
    });
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.hasNextPage()).toBe(true);
    });
    expect(f.nativeElement.textContent).toContain('Voir la suite de la carte');
    expect(f.nativeElement.textContent).not.toContain('pas encore disponible');
  });
});
