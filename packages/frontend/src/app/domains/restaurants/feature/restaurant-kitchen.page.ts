import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import {
  Component,
  linkedSignal,
  computed,
  effect,
  inject,
  signal,
  DestroyRef,
  untracked,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslocoModule } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantPreparationQueries } from '../data-access/restaurant-preparation.queries';
import { KitchenLane } from '../data-access/restaurant-preparation.api';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import { RestaurantAccessNoticeComponent } from '../ui/restaurant-access-notice.component';
import { RestaurantKitchenLaneComponent } from '../ui/restaurant-kitchen-lane.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
@Component({
  selector: 'liass-restaurant-kitchen',
  host: { class: 'block min-w-0' },
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    TranslocoModule,
    RestaurantKitchenLaneComponent,
    RestaurantAccessNoticeComponent,
    LiassPageHeaderComponent,
    LiassSearchableSelectComponent,
  ],
  templateUrl: './restaurant-kitchen.page.html',
  styleUrl: './restaurant-kitchen.page.scss',
})
export class RestaurantKitchenPage {
  readonly operational = inject(RestaurantOutletContext);
  private readonly router = inject(Router);
  readonly queries = inject(RestaurantPreparationQueries);
  readonly caps = inject(RestaurantsCapabilities);
  readonly accessState = inject(RestaurantAccessState);
  private readonly access = inject(ProductAccessState);
  readonly identity = computed(() => JSON.stringify(this.queries.api.context()));
  readonly denied = signal('');
  readonly allowed = computed(
    () =>
      this.caps.canReadKitchen() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.denied() !== this.identity(),
  );
  readonly refreshing = signal(false);
  readonly self = computed(() => !this.caps.canManageSetup());
  readonly outletId = this.operational.id;
  readonly stationId = linkedSignal({
    source: () => [this.identity(), this.outletId()] as const,
    computation: () => '',
  });
  readonly ctx = computed(() => ({ ...this.queries.api.context(), outlet: this.outletId() }));
  get outletsQuery() {
    return this.operational.source();
  }
  readonly outlets = this.operational.outlets;
  readonly outlet = this.operational.outlet;
  readonly stationsQuery = injectInfiniteQuery(() =>
    this.queries.stations(this.ctx(), this.allowed() && !!this.outlet()),
  );
  readonly stations = computed(() =>
    this.stationsQuery.isSuccess()
      ? this.stationsQuery
          .data()
          .pages.filter((page) => page.contextKey === JSON.stringify(this.ctx()))
          .flatMap((page) => page.items)
          .filter((station) => station.outletId === this.ctx().outlet)
      : [],
  );
  readonly activeStations = computed(() => this.stations().filter((station) => station.isActive));
  readonly inactiveStations = computed(() =>
    this.stations().filter((station) => !station.isActive),
  );
  readonly station = computed(() =>
    this.stations().find((station) => station.id === this.stationId()),
  );
  readonly outletOptions = computed(() =>
    this.outlets().map((row) => ({ value: row.id, label: row.name })),
  );
  readonly stationOptions = computed(() =>
    this.activeStations().map((row) => ({ value: row.id, label: row.name })),
  );
  readonly laneViews = viewChildren(RestaurantKitchenLaneComponent);
  readonly commonFailure = computed(() => {
    const views = this.laneViews();
    if (views.length !== 3 || !views.every((lane) => lane.queue.isError())) return false;
    const errors = views.map((lane) => lane.queue.error());
    // Aggregate a common transport/server failure, not unrelated domain failures.
    return errors.every(
      (error) =>
        error instanceof HttpErrorResponse &&
        (error.status === 0 || error.status >= 500) &&
        error.status === (errors[0] as HttpErrorResponse).status,
    );
  });
  readonly lanes: KitchenLane[] = ['IN_PROGRESS', 'READY'];
  readonly readLanes: KitchenLane[] = ['IN_PROGRESS', 'READY', 'QUEUED'];
  readonly mobileLane = signal<KitchenLane>('IN_PROGRESS');
  readonly now = signal(Date.now());
  constructor() {
    let activeOutlet = this.outletId();
    effect(() => {
      const next = this.outletId();
      if (next !== activeOutlet) {
        activeOutlet = next;
        this.stationId.set('');
      }
    });
    let identity = this.identity();
    effect(() => {
      const next = this.identity();
      if (next !== identity) {
        identity = next;
        untracked(() => {
          this.stationId.set('');
        });
      }
    });
    effect(() => {
      const stations = this.activeStations();
      const selected = this.stationId();
      if (!selected && stations.length) this.stationId.set(stations[0].id);
      else if (
        selected &&
        this.stationsQuery.isSuccess() &&
        !this.stations().some((row) => row.id === selected) &&
        !this.stationsQuery.hasNextPage()
      )
        this.stationId.set('');
    });
    effect(() => {
      for (const query of [this.outletsQuery, this.stationsQuery]) {
        const error = query.error();
        if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
          untracked(() => this.denyKitchen());
      }
    });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.now.set(Date.now());
    }, 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
  denyKitchen() {
    const outlet = this.outletId();
    this.denied.set(this.identity());
    if (outlet) void this.operational.revoke(outlet);
  }
  selectStation(id: string) {
    if (this.stations().some((station) => station.id === id)) this.stationId.set(id);
  }
  changeWorkspace() {
    void this.router.navigate(['/select-workspace'], { queryParams: { change: '1' } });
  }
  async refreshAccess() {
    await this.accessState.refresh();
    this.denied.set('');
    await this.outletsQuery.refetch();
  }
  async refresh() {
    if (!this.station() || this.refreshing()) return;
    this.refreshing.set(true);
    try {
      await this.queries.reconcile(this.ctx(), this.stationId(), this.readLanes);
    } finally {
      this.refreshing.set(false);
    }
  }
}
