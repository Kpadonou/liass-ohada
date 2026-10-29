import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';

/** Read-only session identity. Active Outlet selection exists only at product entry. */
@Component({
  selector: 'liass-restaurant-outlet-context',
  host: { class: 'block min-w-0' },
  imports: [MatIconModule, TranslocoModule],
  template: `
    @if (context.id()) {
      <span
        class="flex max-w-[100px] items-center gap-1 px-2 text-xs text-white sm:max-w-[210px] sm:text-sm"
        data-testid="active-restaurant-outlet-name"
        [attr.aria-label]="'RESTAURANTS.CONTEXT.ACTIVE' | transloco"
      >
        <mat-icon class="shrink-0" aria-hidden="true">storefront</mat-icon>
        <span class="truncate">{{ context.outlet()?.name }}</span>
      </span>
    }
  `,
})
export class RestaurantOutletContextComponent {
  readonly context = inject(RestaurantOutletContext);
}
