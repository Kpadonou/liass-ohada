import { RestaurantAccessState } from '../../domains/restaurants/data-access/restaurant-access-state';
import { RestaurantAccessNoticeComponent } from '../../domains/restaurants/ui/restaurant-access-notice.component';
import { Router, RouterOutlet } from '@angular/router';
import { Component, effect, inject } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassCardComponent } from '../../shared/ui/card/card.component';
import { LiassSkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';

@Component({
  selector: 'liass-restaurants-page',
  host: { class: 'block' },
  imports: [
    RouterOutlet,
    RestaurantAccessNoticeComponent,
    TranslocoModule,
    LiassCardComponent,
    LiassSkeletonComponent,
  ],
  templateUrl: './restaurants.page.html',
})
export class RestaurantsPage {
  protected readonly state = inject(RestaurantAccessState);
  private readonly router = inject(Router);
  constructor() {
    effect(() => {
      const mode = this.state.mode();
      if (!this.router.url.split('?')[0].startsWith('/restaurants')) return;
      if (mode === 'service' && !this.router.url.split('?')[0].startsWith('/restaurants/service'))
        void this.router.navigateByUrl('/restaurants/service', { replaceUrl: true });
      else if (mode === 'checkout' && this.router.url.split('?')[0] !== '/restaurants/checkout')
        void this.router.navigateByUrl('/restaurants/checkout', { replaceUrl: true });
      else if (mode === 'kitchen' && this.router.url.split('?')[0] !== '/restaurants/kitchen')
        void this.router.navigateByUrl('/restaurants/kitchen', { replaceUrl: true });
      else if (
        ['configure', 'unsupported', 'changed'].includes(mode) &&
        this.router.url.split('?')[0] !== '/restaurants'
      )
        void this.router.navigateByUrl('/restaurants', { replaceUrl: true });
    });
  }
  protected changeWorkspace() {
    void this.router.navigate(['/select-workspace'], { queryParams: { change: '1' } });
  }
}
