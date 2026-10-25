import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantGuestCarteComponent } from './restaurant-guest-carte.component';
import { RestaurantGuestCarteApi } from '../data-access/restaurant-guest-carte.queries';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { RestaurantGuestCartStore } from '../data-access/restaurant-guest-cart.store';

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
          {
            reference: 'available-item-public-ref',
            selectionRef: 'encrypted-selection-available',
            name: 'Eau minérale',
            amountMinor: 1000,
            availability: 'AVAILABLE',
          },
        ],
      },
    ],
  };
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    read.mockResolvedValue({ body });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    TestBed.configureTestingModule({
      imports: [
        RestaurantGuestCarteComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
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
    f.componentRef.setInput('scope', `liass-restaurants.guest.${'a'.repeat(64)}`);
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
  it('renders ordered categories, text-first items and blocks Add for unavailable items', async () => {
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Poulet braisé');
    });
    expect(f.nativeElement.textContent).toContain('Indisponible');
    expect(f.nativeElement.textContent).toContain('XOF');
    expect(f.nativeElement.querySelector('h2').textContent).toContain('Carte');
    expect(f.nativeElement.querySelector('nav button').getAttribute('aria-pressed')).toBe('true');
    expect(f.nativeElement.textContent).toContain('Ajouter');
    const unavailableLine = [...f.nativeElement.querySelectorAll('li')].find((line: Element) =>
      line.textContent?.includes('Poulet braisé'),
    ) as Element;
    expect(unavailableLine.textContent).not.toContain('Ajouter');
    expect(f.nativeElement.textContent).not.toContain('Commander');
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
    expect(f.nativeElement.textContent).toContain('Hors ligne');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('shows a contextual initial error recoverable through the Guest refresh', async () => {
    read.mockRejectedValue(new Error('offline'));
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.componentInstance.query.isError()).toBe(true);
    });
    expect(f.nativeElement.textContent).toContain('Vérifiez votre connexion');
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
  it('delegates expired access to the recovering read boundary and ends only on its final result', async () => {
    read.mockResolvedValue({ body: { state: 'EXPIRED' } });
    const f = mount(new Date().toISOString());
    const ended = vi.fn();
    f.componentInstance.ended.subscribe(ended);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('EXPIRED'));
    expect(renew).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('makes zero additional reads while canonical TanStack data is fresh', async () => {
    const f = mount();
    await vi.waitFor(() => expect(f.componentInstance.query.isSuccess()).toBe(true));
    const key = [
      'restaurants-guest',
      'carte',
      `liass-restaurants.guest.${'a'.repeat(64)}`,
      'a'.repeat(22),
    ] as const;
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
  it('adds an available item locally without another API request', async () => {
    const f = mount();
    await vi.waitFor(() => {
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Eau minérale');
    });
    const add = [...f.nativeElement.querySelectorAll('button')].find((button: Element) =>
      button.textContent?.includes('Ajouter'),
    ) as HTMLButtonElement;
    add.click();
    f.detectChanges();
    expect(TestBed.inject(RestaurantGuestCartStore).totalUnits()).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(renew).not.toHaveBeenCalled();
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
  it.each(['fr', 'en'])(
    'keeps category navigation and repeated Add local in %s',
    async (language) => {
      TestBed.inject(TranslocoService).setActiveLang(language);
      read.mockResolvedValue({
        body: {
          ...body,
          categories: [
            {
              ...body.categories[0],
              reference: 'desserts',
              name: 'Desserts',
              position: 2,
              items: [],
            },
            body.categories[0],
          ],
        },
      });
      const fixture = mount();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('nav button')).toHaveLength(2);
      });
      const categories = fixture.nativeElement.querySelectorAll('nav button');
      expect(categories[0].textContent).toContain('Grillades');
      const section = fixture.nativeElement.querySelector('#category-desserts');
      section.scrollIntoView = vi.fn();
      categories[1].focus();
      categories[1].click();
      fixture.detectChanges();
      expect(categories[1].getAttribute('aria-pressed')).toBe('true');
      expect(document.activeElement).toBe(categories[1]);
      expect(section.scrollIntoView).toHaveBeenCalled();
      const add = [...fixture.nativeElement.querySelectorAll('li button')][0] as HTMLButtonElement;
      expect(add.textContent).toContain(language === 'fr' ? 'Ajouter' : 'Add');
      add.click();
      add.click();
      expect(TestBed.inject(RestaurantGuestCartStore).totalUnits()).toBe(2);
      expect(read).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.textContent).not.toContain('RESTAURANTS.');
    },
  );
  it.each(['fr', 'en'])(
    'filters loaded menu names immediately without extra reads in %s',
    async (language) => {
      TestBed.inject(TranslocoService).setActiveLang(language);
      const fixture = mount();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeTruthy();
      });
      const search = fixture.nativeElement.querySelector(
        'input[type="search"]',
      ) as HTMLInputElement;
      expect(fixture.nativeElement.querySelector('mat-label').textContent).toContain(
        language === 'fr' ? 'Rechercher un article' : 'Search menu items',
      );
      search.value = 'BRAISE';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(1);
      expect(fixture.nativeElement.textContent).toContain('Poulet braisé');
      expect(fixture.nativeElement.textContent).toContain(
        language === 'fr' ? 'Indisponible' : 'Unavailable',
      );
      expect(fixture.nativeElement.querySelector('li button')).toBeNull();
      search.value = 'minerale';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Eau minérale');
      expect(fixture.nativeElement.querySelector('li button')).toBeTruthy();
      expect(fixture.nativeElement.textContent.replace(/\s/g, '')).toContain(
        language === 'fr' ? '1000XOF' : 'XOF1,000',
      );
      search.value = 'not-a-dish';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        language === 'fr' ? 'Aucun article trouvé.' : 'No menu items found.',
      );
      search.value = '';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(2);
      expect(read).toHaveBeenCalledTimes(1);
      expect(renew).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).not.toContain('RESTAURANTS.');
    },
  );
  it('never presents a partial cache as an exhaustive no-match result', async () => {
    read.mockResolvedValue({ body: { ...body, nextCursor: 'next-page-reference' } });
    const fixture = mount();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.query.isSuccess()).toBe(true);
    });
    fixture.componentInstance.searchText.set('not-a-dish');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Aucun résultat dans les articles affichés',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Aucun article trouvé.');
    expect(fixture.nativeElement.textContent).toContain('Voir la suite de la carte');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('keeps grouped prices through the established currency formatter', async () => {
    const fixture = mount();
    await vi.waitFor(() => expect(fixture.componentInstance.query.isSuccess()).toBe(true));
    expect(fixture.componentInstance.price(150000)).toMatch(/150\s000\sXOF/);
  });
});
