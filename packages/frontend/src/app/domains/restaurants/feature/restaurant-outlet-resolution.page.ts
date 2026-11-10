import { MatDialog } from '@angular/material/dialog';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantEditorComponent } from './restaurant-editor.component';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
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
    LiassButtonComponent,
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
        } @else if (canBootstrap()) {
          @if (root.isPending()) {
            <div role="status">{{ 'RESTAURANTS.UI.LOADING' | transloco }}</div>
            <liass-skeleton variant="block" />
          } @else if (root.isError()) {
            <p role="alert">{{ 'RESTAURANTS.UI.ERRORS.NETWORK' | transloco }}</p>
            <liass-button (pressed)="root.refetch()">{{ 'RESTAURANTS.UI.REFRESH' | transloco }}</liass-button>
          } @else if (root.data() && !root.data()?.isActive) {
            <p>{{ 'RESTAURANTS.UI.INACTIVE_ROOT' | transloco }}</p>
          } @else {
            <p class="mb-4">{{ (root.data() ? 'RESTAURANTS.CONTEXT.FIRST_OUTLET' : 'RESTAURANTS.UI.EMPTY_RESTAURANT') | transloco }}</p>
            <liass-button icon="add" tone="brand" variant="solid" (pressed)="createFirst()">
              {{ (root.data() ? 'RESTAURANTS.UI.ADD_LOCATION' : 'RESTAURANTS.UI.START') | transloco }}
            </liass-button>
          }
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
  private readonly auth = inject(AuthStore);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly queries = inject(RestaurantsQueries);
  private readonly dialog = inject(MatDialog);
  readonly canBootstrap = computed(() =>
    this.routing.resolution() === 'no-accessible-context' &&
    this.auth.activeWorkspace()?.productRoles?.RESTAURANTS === 'OWNER' &&
    this.caps.canManageSetup() &&
    this.routing.context.managementQuery.data()?.pages.every((page) => page.items.length === 0) === true,
  );
  readonly root = injectQuery(() => this.queries.get('restaurant', {}, this.canBootstrap()));
  createFirst() {
    if (!this.canBootstrap() || !this.root.isSuccess()) return;
    const restaurant = this.root.data();
    if (restaurant && !restaurant.isActive) return;
    const identity = this.routing.context.identity();
    const kind = restaurant ? 'outlet' : 'restaurant';
    this.dialog.open(RestaurantEditorComponent, {
      width: '560px',
      maxWidth: 'calc(100vw - 24px)',
      disableClose: true,
      data: { org: this.queries.scope(), kind, context: {} },
    }).afterClosed().subscribe((saved) => {
      if (!saved || this.routing.context.identity() !== identity) return;
      if (kind === 'outlet') void this.routing.context.source().refetch();
      else void this.root.refetch();
    });
  }
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
