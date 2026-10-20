import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { RestaurantsPage } from '../../../core/restaurants/restaurants.page';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
describe('Receipt direct refresh preserves cashier document route', () => {
  it('does not redirect an authorized receipt to Caisse when access resolves', () => {
    const mode = signal('loading');
    const router = {
      url: '/restaurants/outlets/outlet/sessions/session/receipt',
      navigateByUrl: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [RestaurantsPage],
      providers: [
        { provide: Router, useValue: router },
        { provide: RestaurantAccessState, useValue: { mode } },
      ],
    });
    TestBed.overrideComponent(RestaurantsPage, { set: { template: '' } });
    const f = TestBed.createComponent(RestaurantsPage);
    f.detectChanges();
    mode.set('checkout');
    f.detectChanges();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
  });
});
