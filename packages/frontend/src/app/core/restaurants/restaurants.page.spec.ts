import { RestaurantAccessState } from '../../domains/restaurants/data-access/restaurant-access-state';
import { signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { ProductAccessState } from '../product-access/product-access.state';
import { RestaurantsCapabilities } from '../../domains/restaurants/data-access/restaurants-capabilities';
import type { ProductAvailability } from '../product-access/product-availability';
import { RestaurantsPage } from './restaurants.page';
const translations = {
  RESTAURANTS: {
    PAGE: { TITLE: 'Liass-Resto', EYEBROW: 'Liass-OHADA', SUBTITLE: 'Your restaurant' },
    ACCESS: { CHECKING: 'Checking access', DENIED: 'Access unavailable' },
    ACCESS_LIFECYCLE: { CHANGED: { TITLE: 'Access changed' } },
    UI: {
      NAV: { OVERVIEW: 'Overview', SETUP: 'Restaurant setup', MENU: 'Menu', LABEL: 'Navigation' },
    },
  },
};
describe('Liass-Resto product navigation', () => {
  const availability = signal<ProductAvailability>('UNKNOWN'),
    read = signal(true),
    menu = signal(true);
  beforeEach(() => {
    availability.set('UNKNOWN');
    read.set(true);
    menu.set(true);
    TestBed.configureTestingModule({
      imports: [
        RestaurantsPage,
        TranslocoTestingModule.forRoot({
          langs: { en: translations },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([]),
        {
          provide: RestaurantAccessState,
          useValue: {
            mode: computed(() =>
              availability() === 'UNKNOWN'
                ? 'checking'
                : availability() === 'AVAILABLE'
                  ? 'management'
                  : 'changed',
            ),
            role: () => 'OWNER',
            refreshing: () => false,
            refreshFailed: () => false,
          },
        },
        { provide: ProductAccessState, useValue: { availability } },
        { provide: RestaurantsCapabilities, useValue: { canRead: read, canReadMenu: menu } },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('renders the product outlet without duplicated horizontal navigation or product headers', () => {
    availability.set('AVAILABLE');
    const f = TestBed.createComponent(RestaurantsPage);
    f.detectChanges();
    expect(f.nativeElement.querySelector('router-outlet')).not.toBeNull();
    expect(f.nativeElement.querySelector('nav')).toBeNull();
    expect(f.nativeElement.querySelector('liass-page-header')).toBeNull();
  });
  it('announces access loading and hides business navigation', () => {
    const f = TestBed.createComponent(RestaurantsPage);
    f.detectChanges();
    expect(f.nativeElement.querySelector('[aria-busy="true"]').textContent).toContain(
      'Checking access',
    );
    expect(f.nativeElement.querySelector('nav')).toBeNull();
  });
  it('removes business content on ProductAccess loss', () => {
    availability.set('AVAILABLE');
    const f = TestBed.createComponent(RestaurantsPage);
    f.detectChanges();
    availability.set('UNAVAILABLE');
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role="alert"]').textContent).toContain('Access changed');
    expect(f.nativeElement.querySelector('router-outlet')).toBeNull();
  });
});
