import { Component, computed, inject } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

import { ProductAccessState } from '../product-access/product-access.state';
import { LiassCardComponent } from '../../shared/ui/card/card.component';
import { LiassSkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';
import { LiassPageHeaderComponent } from '../../shared/ui/page-header/page-header.component';

@Component({
  selector: 'liass-restaurants-page',
  host: { class: 'block' },
  imports: [TranslocoModule, LiassCardComponent, LiassPageHeaderComponent, LiassSkeletonComponent],
  templateUrl: './restaurants.page.html',
})
export class RestaurantsPage {
  private readonly productAccess = inject(ProductAccessState);
  protected readonly availability = computed(() => this.productAccess.availability('RESTAURANTS'));
}
