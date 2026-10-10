import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { ProductAccessState } from '../product-access/product-access.state';
import type { ProductAvailability } from '../product-access/product-availability';
import { RestaurantsPage } from './restaurants.page';

const translations = {
  RESTAURANTS: {
    PAGE: {
      TITLE: 'Liass-Resto',
      EYEBROW: 'Liass-OHADA',
      SUBTITLE: 'Restaurant management workspace',
      READY: 'Workspace accessible',
    },
    ACCESS: { CHECKING: 'Checking access', DENIED: 'Access unavailable' },
  },
};
describe('RestaurantsPage foundation', () => {
  const availability = signal<ProductAvailability>('UNKNOWN');
  beforeEach(() => {
    availability.set('UNKNOWN');
    TestBed.configureTestingModule({
      imports: [
        RestaurantsPage,
        TranslocoTestingModule.forRoot({
          langs: { en: translations },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [{ provide: ProductAccessState, useValue: { availability } }],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('renders translated header, landing and stable shared page primitives', () => {
    availability.set('AVAILABLE');
    const fixture = TestBed.createComponent(RestaurantsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Liass-Resto');
    expect(fixture.nativeElement.textContent).toContain('Restaurant management workspace');
    expect(fixture.nativeElement.textContent).toContain('Workspace accessible');
    expect(
      fixture.nativeElement.querySelector('liass-page-header').classList.contains('block'),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('liass-card').classList.contains('block')).toBe(
      true,
    );
  });
  it('shows access loading and hides the landing until verified', () => {
    const fixture = TestBed.createComponent(RestaurantsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]').textContent).toContain(
      'Checking access',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Workspace accessible');
  });
  it('removes authorized content when the active workspace loses access', () => {
    availability.set('AVAILABLE');
    const fixture = TestBed.createComponent(RestaurantsPage);
    fixture.detectChanges();
    availability.set('UNAVAILABLE');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Access unavailable',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Workspace accessible');
  });
});
