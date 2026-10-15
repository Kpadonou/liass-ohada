import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import {
  ResponsibleStaffDialogComponent,
  ResponsibilityIntent,
} from './responsible-staff-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import type { RestaurantServiceFloorResponse } from '@liass-ohada/shared/restaurants';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { restaurantPrice } from '../utils/restaurant-money';
import { restaurantError } from '../utils/restaurant-errors';
import { serviceDuration } from '../utils/service-duration';
type FloorTable = RestaurantServiceFloorResponse['items'][number];

@Component({
  selector: 'liass-restaurant-service-floor',
  host: { class: 'block' },
  imports: [
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatMenuModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslocoModule,
    LiassCardComponent,
    LiassPageHeaderComponent,
    LiassStatusChipComponent,
    LiassSkeletonComponent,
    LiassSearchableSelectComponent,
  ],
  templateUrl: './restaurant-service-floor.page.html',
  styleUrl: './restaurant-service-floor.page.scss',
})
export class RestaurantServiceFloorPage {
  readonly queries = inject(RestaurantsQueries);
  readonly caps = inject(RestaurantsCapabilities);
  private readonly api = inject(RestaurantsApi);
  private readonly dialog = inject(MatDialog);
  private readonly responsibilityIntents = new Map<string, ResponsibilityIntent>();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  private readonly access = inject(ProductAccessState);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly denied = signal<string | null>(null);
  readonly availability = computed(() => this.access.availability('RESTAURANTS'));
  readonly allowed = computed(
    () =>
      this.availability() === 'AVAILABLE' &&
      this.caps.canReadService() &&
      this.denied() !== this.queries.scope(),
  );
  readonly outletId = signal<string | null>(null);
  readonly areaId = signal<string | null>(null);
  readonly root = injectQuery(() => this.queries.get('restaurant', {}, this.allowed()));
  readonly locations = injectInfiniteQuery(() =>
    this.queries.list('outlet', {}, this.allowed() && !!this.root.data()),
  );
  readonly outlets = computed(() => this.locations.data()?.pages.flatMap((p) => p.items) ?? []);
  readonly outlet = computed(() => this.outlets().find((o) => o.id === this.outletId()));
  readonly areas = injectInfiniteQuery(() =>
    this.queries.list(
      'area',
      { outletId: this.outletId() ?? undefined },
      this.allowed() && !!this.outlet(),
    ),
  );
  readonly areaRows = computed(() => this.areas.data()?.pages.flatMap((p) => p.items) ?? []);
  readonly outletOptions = computed(() =>
    this.outlets().map((o) => ({ value: o.id, label: o.name })),
  );
  readonly areaOptions = computed(() => [
    { value: 'ALL', label: this.t.translate('RESTAURANTS.SERVICE.ALL') },
    ...this.areaRows().map((a) => ({ value: a.id, label: a.name })),
  ]);
  readonly floor = injectInfiniteQuery(() =>
    this.queries.serviceFloor(this.outletId() ?? '', this.allowed() && !!this.outlet()),
  );
  readonly tables = computed(() => {
    const unique = new Map<string, FloorTable>();
    for (const table of this.floor.data()?.pages.flatMap((p) => p.items) ?? [])
      unique.set(table.tableId, table);
    return [...unique.values()];
  });
  readonly visibleTables = computed(() =>
    this.tables().filter((table) => !this.areaId() || table.areaId === this.areaId()),
  );
  readonly now = signal(Date.now());
  readonly busy = signal<string | null>(null);
  readonly openingError = signal<string | null>(null);
  private readonly intents = new Map<string, string>();
  private conflictRefresh = '';
  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    effect(() => {
      const params = this.params();
      this.outletId.set(params.get('outlet'));
      this.areaId.set(params.get('area'));
    });
    effect(() => {
      if (!this.outletId() && this.outlets().length)
        this.outletId.set((this.outlets().find((o) => o.isActive) ?? this.outlets()[0]).id);
    });
    let previous = this.queries.scope();
    effect(() => {
      const org = this.queries.scope();
      if (org !== previous) {
        previous = org;
        this.outletId.set(null);
        this.areaId.set(null);
        this.intents.clear();
        this.responsibilityIntents.clear();
        this.busy.set(null);
        this.denied.set(null);
        this.openingError.set(null);
      }
    });
    effect(() => {
      const error = this.floor.error();
      if (!error) this.conflictRefresh = '';
      if (!(error instanceof HttpErrorResponse)) return;
      if (error.status === 403) {
        this.denied.set(this.queries.scope());
        void this.queries.denied(this.queries.scope());
      }
      if (error.status === 409) {
        const identity =
          this.queries.scope() + ':' + this.outletId() + ':' + this.floor.errorUpdatedAt();
        if (
          identity !== this.conflictRefresh &&
          !this.conflictRefresh.startsWith(this.queries.scope() + ':' + this.outletId() + ':')
        ) {
          this.conflictRefresh = identity;
          void untracked(() => this.floor.refetch());
        }
      }
    });
  }
  selectOutlet(value: string | null) {
    this.outletId.set(value);
    this.areaId.set(null);
    this.openingError.set(null);
    this.writeContext();
  }
  selectArea(value: string | null) {
    this.areaId.set(value === 'ALL' ? null : value);
    this.writeContext();
  }
  private writeContext() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { outlet: this.outletId(), area: this.areaId() },
      queryParamsHandling: 'merge',
    });
  }
  async refresh() {
    this.conflictRefresh = '';
    await this.floor.refetch();
  }
  errorText(error: unknown) {
    return restaurantError(error, (key) => this.t.translate(key));
  }
  duration(openedAt: string) {
    const value = serviceDuration(openedAt, this.now());
    return this.t.translate(value.key, value.values);
  }
  amount(amount: number, currency: string) {
    return restaurantPrice(amount, currency, this.t.getActiveLang());
  }
  canOpenTable(table: FloorTable) {
    return (
      !!this.root.data()?.isActive &&
      this.caps.canOpenSession() &&
      !!this.outlet()?.isActive &&
      !this.areaRows().some((area) => area.id === table.areaId && !area.isActive)
    );
  }
  responsibleName(table: FloorTable) {
    return table.state === 'OCCUPIED'
      ? (table.responsibleStaff?.displayName ?? this.t.translate('RESTAURANTS.TEAM.UNNAMED'))
      : '';
  }
  manageResponsibility(table: FloorTable, clear: boolean, returnFocus: { focus: () => void }) {
    const org = this.queries.scope(),
      outletId = this.outletId();
    if (
      !this.allowed() ||
      !this.caps.canManageResponsibility() ||
      !outletId ||
      table.state !== 'OCCUPIED'
    )
      return;
    const key = org + ':' + outletId + ':' + table.guestSessionId;
    const intent = this.responsibilityIntents.get(key) ?? {};
    this.responsibilityIntents.set(key, intent);
    this.dialog
      .open(ResponsibleStaffDialogComponent, {
        width: '560px',
        maxWidth: 'calc(100vw - 24px)',
        panelClass: 'liass-dialog-panel',
        autoFocus: 'first-tabbable',
        restoreFocus: false,
        data: {
          org,
          outletId,
          table,
          intent,
          clear: intent.current ? intent.current.staffId === null : clear,
          isCurrent: () => this.allowed() && this.outletId() === outletId,
          canAssign: () => this.outlet()?.isActive === true,
        },
      })
      .afterClosed()
      .subscribe(() => {
        if (this.queries.scope() === org && this.outletId() === outletId) returnFocus.focus();
      });
  }
  async open(table: FloorTable) {
    const org = this.queries.scope(),
      outlet = this.outlet();
    if (
      !this.allowed() ||
      !this.canOpenTable(table) ||
      !outlet ||
      table.state !== 'FREE' ||
      this.busy() ||
      !this.tables().some((t) => t.tableId === table.tableId && t.state === 'FREE')
    )
      return;
    const key = org + ':' + outlet.id + ':' + table.tableId;
    const id = this.intents.get(key) ?? crypto.randomUUID();
    this.intents.set(key, id);
    this.busy.set(key);
    this.openingError.set(null);
    try {
      const result = await this.api.openSession(org, outlet.id, {
        clientRequestId: id,
        tableId: table.tableId,
        areaId: table.areaId,
      });
      this.intents.delete(key);
      await this.queries.floorChanged(org, outlet.id);
      if (this.queries.scope() === org && this.outletId() === outlet.id)
        this.notification.success(result.message ?? this.t.translate('RESTAURANTS.SERVICE.OPENED'));
    } catch (error) {
      if (this.queries.scope() === org && this.outletId() === outlet.id) {
        this.openingError.set(
          error instanceof HttpErrorResponse && error.status === 409
            ? this.t.translate('RESTAURANTS.SERVICE.OPEN_CONFLICT')
            : this.errorText(error),
        );
        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.denied.set(org);
          void this.queries.denied(org);
        }
      }
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.intents.delete(key);
        await this.queries.floorChanged(org, outlet.id);
      }
    } finally {
      if (this.busy() === key) this.busy.set(null);
    }
  }
}
