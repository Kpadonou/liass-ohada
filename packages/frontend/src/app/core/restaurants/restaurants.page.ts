import { RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { RestaurantsCapabilities } from '../../domains/restaurants/data-access/restaurants-capabilities';
import { Component, computed, inject } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

import { ProductAccessState } from '../product-access/product-access.state';
import { LiassCardComponent } from '../../shared/ui/card/card.component';
import { LiassSkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';

@Component({
  selector: 'liass-restaurants-page',
  host: { class: 'block' },
  imports: [
    RouterOutlet,
    MatButtonModule,
    TranslocoModule,
    LiassCardComponent,
    LiassSkeletonComponent,
  ],
  templateUrl: './restaurants.page.html',
})
export class RestaurantsPage {
  protected readonly capabilities = inject(RestaurantsCapabilities);
  private readonly productAccess = inject(ProductAccessState);
  protected readonly availability = computed(() => this.productAccess.availability('RESTAURANTS'));
}
