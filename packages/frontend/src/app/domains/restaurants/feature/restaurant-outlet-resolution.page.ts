import { Component, computed, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantOutletRouting } from '../data-access/restaurant-outlet-routing';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';

/** Product entry workflow: no functional component is mounted underneath selection. */
@Component({
  selector: 'liass-restaurant-outlet-resolution',
  host: { class: 'block' },
  imports: [
    FormsModule,
    MatButtonModule,
    TranslocoModule,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassSearchableSelectComponent,
  ],
  template: `
    <div class="mx-auto w-full max-w-2xl space-y-6 py-6 sm:py-10">
      <liass-page-header
        eyebrow=""
        [title]="
          (canChoose() ? 'RESTAURANTS.CONTEXT.CHOOSE' : 'RESTAURANTS.PAGE.TITLE') | transloco
        "
        [subtitle]="
          canChoose()
            ? ('RESTAURANTS.CONTEXT.ENTRY_DESCRIPTION' | transloco)
            : resolving()
              ? ('RESTAURANTS.ACCESS.CHECKING' | transloco)
              : ''
        "
      />
      <liass-card>
        @if (resolving()) {
          <div class="space-y-3" role="status" aria-busy="true">
            <p>{{ 'RESTAURANTS.ACCESS.CHECKING' | transloco }}</p>
            <liass-skeleton variant="block" />
          </div>
        } @else {
          <div class="space-y-4">
            <p [attr.role]="routing.resolution() === 'selection-required' ? 'status' : 'alert'">
              {{ 'RESTAURANTS.CONTEXT.RESOLUTION.' + routing.resolution() | transloco }}
            </p>
            @if (canChoose()) {
              <liass-searchable-select
                class="block w-full sm:max-w-sm"
                controlType="select"
                labelKey="RESTAURANTS.CONTEXT.CHOOSE"
                [options]="options()"
                [ngModel]="null"
                (ngModelChange)="routing.choose($event)"
              />
            }
            @if (routing.context.available() && routing.context.source().hasNextPage()) {
              <button
                mat-button
                type="button"
                [disabled]="routing.context.source().isFetchingNextPage()"
                (click)="routing.context.source().fetchNextPage()"
              >
                {{ 'RESTAURANTS.UI.MORE_LOCATIONS' | transloco }}
              </button>
            }
            @if (routing.resolution() === 'error') {
              <button mat-stroked-button type="button" (click)="routing.context.source().refetch()">
                {{ 'RESTAURANTS.UI.REFRESH' | transloco }}
              </button>
            }
          </div>
        }
      </liass-card>
    </div>
  `,
})
export class RestaurantOutletResolutionPage {
  readonly routing = inject(RestaurantOutletRouting);
  readonly resolving = computed(() => ['loading', 'ready'].includes(this.routing.resolution()));
  readonly options = computed(() =>
    this.routing.context.outlets().map((row) => ({ value: row.id, label: row.name })),
  );
  readonly canChoose = computed(
    () =>
      !this.routing.context.sessionInvalid() &&
      !this.routing.context.id() &&
      (!this.routing.resourceTarget() ||
        this.options().some((row) => row.value === this.routing.destination()?.hint)) &&
      this.options().length > 0 &&
      ['selection-required', 'invalid-selection'].includes(this.routing.resolution()),
  );
  constructor() {
    const route = inject(ActivatedRoute),
      router = inject(Router);
    if (!this.routing.begin(route.snapshot.queryParamMap.get('returnUrl') ?? '')) {
      void router.navigateByUrl('/restaurants', { replaceUrl: true });
    }
    effect(() => {
      if (this.routing.resolution() === 'ready') untracked(() => void this.routing.resume());
    });
  }
}
