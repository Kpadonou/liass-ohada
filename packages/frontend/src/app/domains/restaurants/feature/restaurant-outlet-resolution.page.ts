import { Component, computed, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
    RouterLink,
    MatButtonModule,
    TranslocoModule,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassSkeletonComponent,
    LiassSearchableSelectComponent,
  ],
  template: `
    <div class="space-y-6">
      <liass-page-header
        eyebrow=""
        [title]="
          (resolving() ? 'RESTAURANTS.PAGE.TITLE' : 'RESTAURANTS.CONTEXT.CHOOSE') | transloco
        "
        [subtitle]="
          (resolving() ? 'RESTAURANTS.ACCESS.CHECKING' : 'RESTAURANTS.CONTEXT.ENTRY_DESCRIPTION')
            | transloco
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
            @if (routing.resolution() === 'access-changed') {
              <button
                mat-stroked-button
                type="button"
                [disabled]="routing.access.refreshing()"
                (click)="routing.refreshAccess()"
              >
                {{ 'RESTAURANTS.UI.REFRESH' | transloco }}
              </button>
            }
            @if (routing.context.management()) {
              <a mat-button routerLink="/restaurants/setup/locations">{{
                'RESTAURANTS.UI.LOCATION' | transloco
              }}</a>
            }
            <a mat-button routerLink="/restaurants">{{
              'RESTAURANTS.CONTEXT.BACK_TO_PRODUCT' | transloco
            }}</a>
            <a mat-button routerLink="/select-workspace" [queryParams]="{ change: '1' }">
              {{ 'RESTAURANTS.CONTEXT.CHANGE_WORKSPACE' | transloco }}
            </a>
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
      !this.routing.resourceTarget() &&
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
