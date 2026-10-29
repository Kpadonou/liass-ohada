import { RestaurantOutletRouting } from '../data-access/restaurant-outlet-routing';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import fr from '../../../../../public/assets/i18n/fr.json';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { RestaurantOutletContextComponent } from './restaurant-outlet-context.component';
const rows = signal([{ id: 'a', name: 'Terrasse jardin' }]),
  selected = signal('a');
const switchOutlet = vi.fn((id: string) => selected.set(id));
beforeEach(() => {
  rows.set([{ id: 'a', name: 'Terrasse jardin' }]);
  selected.set('a');
  switchOutlet.mockClear();
  TestBed.configureTestingModule({
    imports: [
      RestaurantOutletContextComponent,
      TranslocoTestingModule.forRoot({
        langs: { fr },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: RestaurantOutletRouting, useValue: { switchOutlet } },
      {
        provide: RestaurantOutletContext,
        useValue: {
          attached: () => true,
          outlets: rows,
          id: selected,
          outlet: computed(() => rows().find((row) => row.id === selected())),
          multiple: computed(() => rows().length > 1),
          source: () => ({ hasNextPage: () => false }),
          select: (id: string) => selected.set(id),
        },
      },
    ],
  });
});
afterEach(() => TestBed.resetTestingModule());
it('shows a single authorized name without a dropdown or selection step', () => {
  const f = TestBed.createComponent(RestaurantOutletContextComponent);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('Terrasse jardin');
  expect(f.nativeElement.querySelector('button')).toBeNull();
  expect(
    f.nativeElement.querySelector('[data-testid="active-restaurant-outlet-name"]'),
  ).not.toBeNull();
});
it('shows no empty selector for zero assignments', () => {
  rows.set([]);
  const f = TestBed.createComponent(RestaurantOutletContextComponent);
  f.detectChanges();
  expect(f.nativeElement.querySelector('button,mat-select,input')).toBeNull();
});
it('shows multiple-outlet session identity read-only, with no selection action', () => {
  rows.set([
    { id: 'a', name: 'Terrasse jardin' },
    { id: 'b', name: 'Salle principale' },
  ]);
  const f = TestBed.createComponent(RestaurantOutletContextComponent);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('Terrasse jardin');
  expect(f.nativeElement.querySelector('button,mat-select,input,[aria-haspopup]')).toBeNull();
  expect(switchOutlet).not.toHaveBeenCalled();
});
