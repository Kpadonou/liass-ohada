import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { RestaurantOutletRouting } from '../data-access/restaurant-outlet-routing';

/** Shell adapter; never a page-local outlet filter. */
@Component({
  selector: 'liass-restaurant-outlet-context',
  host: { class: 'block min-w-0' },
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatInputModule, TranslocoModule],
  template: `
    @if (context.attached()) {
      @if (context.multiple()) {
        <button
          mat-button
          type="button"
          class="!h-10 !min-w-0 !max-w-[100px] !px-2 !text-white sm:!max-w-[210px]"
          [matMenuTriggerFor]="outlets"
          data-testid="active-restaurant-outlet"
          [attr.aria-label]="
            ('RESTAURANTS.CONTEXT.ACTIVE' | transloco) +
            ': ' +
            (context.outlet()?.name ?? ('RESTAURANTS.CONTEXT.CHOOSE' | transloco))
          "
        >
          <span class="flex min-w-0 items-center gap-1">
            <mat-icon class="shrink-0" aria-hidden="true">storefront</mat-icon>
            <span class="min-w-0 truncate">{{
              context.outlet()?.name ?? ('RESTAURANTS.CONTEXT.CHOOSE' | transloco)
            }}</span>
            <mat-icon class="shrink-0" aria-hidden="true">expand_more</mat-icon>
          </span>
        </button>
        <mat-menu #outlets="matMenu">
          @if (context.outlets().length > 10) {
            <input
              matInput
              class="px-4 py-2"
              type="search"
              [attr.aria-label]="'RESTAURANTS.CONTEXT.SEARCH' | transloco"
              (click)="$event.stopPropagation()"
              (keydown)="$event.stopPropagation()"
              [value]="search()"
              (input)="search.set($any($event.target).value)"
            />
          }
          @for (outlet of filtered(); track outlet.id) {
            <button
              mat-menu-item
              type="button"
              [attr.aria-current]="context.id() === outlet.id ? 'true' : null"
              (click)="select(outlet.id)"
            >
              <mat-icon>storefront</mat-icon><span>{{ outlet.name }}</span>
            </button>
          }
          @if (context.source().hasNextPage()) {
            <button
              mat-menu-item
              type="button"
              [disabled]="context.source().isFetchingNextPage()"
              (click)="context.source().fetchNextPage()"
            >
              {{ 'RESTAURANTS.UI.MORE_LOCATIONS' | transloco }}
            </button>
          }
        </mat-menu>
      } @else if (context.outlet(); as outlet) {
        <span
          class="flex max-w-[100px] items-center gap-1 px-2 text-xs text-white sm:max-w-[210px] sm:text-sm"
          data-testid="active-restaurant-outlet-name"
          [attr.aria-label]="'RESTAURANTS.CONTEXT.ACTIVE' | transloco"
        >
          <mat-icon class="shrink-0" aria-hidden="true">storefront</mat-icon
          ><span class="truncate">{{ outlet.name }}</span>
        </span>
      }
    }
  `,
})
export class RestaurantOutletContextComponent {
  readonly context = inject(RestaurantOutletContext);
  private readonly routing = inject(RestaurantOutletRouting);
  select(id: string) {
    void this.routing.switchOutlet(id);
  }
  readonly search = signal('');
  readonly filtered = computed(() =>
    this.context.outlets().filter((row) =>
      row.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(
          this.search()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase(),
        ),
    ),
  );
}
