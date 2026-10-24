import { QueryClient } from '@tanstack/angular-query-experimental';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import en from '../../../../../public/assets/i18n/en.json';
import { RestaurantGuestCartStore } from '../data-access/restaurant-guest-cart.store';
import { RestaurantGuestCartComponent } from './restaurant-guest-cart.component';

const scope = `liass-restaurants.guest.${'a'.repeat(64)}`;
const context = {
  state: 'FREE' as const,
  visitRef: null,
  guestHandle: 'g'.repeat(22),
  capability: 'capability',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  restaurantName: 'Restaurant Démo',
  outletName: 'Centre-ville',
  tableName: 'Terrasse 4',
  policy: 'STAFF_APPROVAL' as const,
  orderingPermitted: false,
  waiterCallAvailable: true as const,
};

describe('RestaurantGuestCartComponent', () => {
  let store: RestaurantGuestCartStore;
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: QueryClient, useFactory: () => new QueryClient() },
        {
          provide: RestaurantGuestApi,
          useValue: {
            submissionState: vi.fn().mockResolvedValue({ state: 'READY', requests: [] }),
          },
        },
      ],
      imports: [
        RestaurantGuestCartComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr, en },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr', 'en'], defaultLang: 'fr' },
        }),
      ],
    });
    store = TestBed.inject(RestaurantGuestCartStore);
    store.activate(scope, context);
    store.add(
      {
        reference: 'available-public-reference',
        selectionRef: 'encrypted-selection-reference',
        name: 'Poulet braisé',
        amountMinor: 3500,
        availability: 'AVAILABLE',
      },
      'XOF',
      new Date(Date.now() + 900_000).toISOString(),
    );
  });
  afterEach(() => {
    document.querySelector('.cdk-overlay-container')?.remove();
    TestBed.resetTestingModule();
  });

  function mount() {
    const fixture = TestBed.createComponent(RestaurantGuestCartComponent);
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('context', context);
    fixture.detectChanges();
    return fixture;
  }

  it('offers a strong cart entry point and accessible cart controls in French', async () => {
    const fixture = mount();
    expect(fixture.nativeElement.textContent).toContain('Voir le panier');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    expect(overlay.textContent).toContain('Votre sélection');
    expect(overlay.textContent).toContain('Retirer');
    expect(overlay.querySelector('input')?.getAttribute('aria-label')).toContain('Quantité');
    expect(overlay.querySelectorAll('button[aria-label]').length).toBeGreaterThanOrEqual(2);
    expect(overlay.querySelector('textarea')?.getAttribute('maxlength')).toBe('250');
  });

  it('renders the cart workflow in English without changing its local state', async () => {
    TestBed.inject(TranslocoService).setActiveLang('en');
    const fixture = mount();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('View cart');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(document.querySelector('.cdk-overlay-container')?.textContent).toContain('Remove');
    expect(store.lines()).toHaveLength(1);
  });

  it('edits quantity, note and removal immediately with no HTTP dependency', async () => {
    const fixture = mount();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    const labelledButtons = [...overlay.querySelectorAll('button[aria-label]')];
    (
      labelledButtons.find((button) => button.getAttribute('aria-label')?.includes('Augmenter')) as
        | HTMLButtonElement
        | undefined
    )?.click();
    expect(store.totalUnits()).toBe(2);
    const input = overlay.querySelector('input') as HTMLInputElement;
    input.value = '5';
    input.dispatchEvent(new Event('blur'));
    expect(store.totalUnits()).toBe(5);
    const textarea = overlay.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Sans piment';
    textarea.dispatchEvent(new Event('input'));
    expect(store.lines()[0].note).toBe('Sans piment');
    const remove = [...overlay.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retirer'),
    ) as HTMLButtonElement;
    remove.click();
    expect(store.lines()).toEqual([]);
  });
});
