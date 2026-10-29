import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import {
  RestaurantContext,
  RestaurantKind,
  RestaurantEntity,
  RestaurantListKind,
} from '../data-access/restaurants-model';
import { RestaurantEditorComponent } from './restaurant-editor.component';
import { RestaurantQrDialogComponent } from './restaurant-qr-dialog.component';
import { restaurantPrice } from '../utils/restaurant-money';
import { restaurantError } from '../utils/restaurant-errors';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { LiassConfirmationDialogComponent } from '../../../shared/ui/confirmation-dialog/confirmation-dialog.component';

function collectionState(query: {
  data: () => { pages: { items: RestaurantEntity[] }[] } | undefined;
  isPending: () => boolean;
  isError: () => boolean;
  error: () => unknown;
  hasNextPage: () => boolean;
  isFetchingNextPage: () => boolean;
  refetch: () => Promise<unknown>;
  fetchNextPage: () => Promise<unknown>;
}) {
  return {
    items: query.data()?.pages.flatMap((page) => page.items) ?? [],
    pending: query.isPending(),
    failed: query.isError(),
    error: query.error(),
    more: query.hasNextPage(),
    fetchingMore: query.isFetchingNextPage(),
    refetch: () => query.refetch(),
    next: () => query.fetchNextPage(),
  };
}
@Component({
  selector: 'liass-restaurants-workspace',
  host: { class: 'block' },
  imports: [
    NgTemplateOutlet,
    RouterLink,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TranslocoModule,
    LiassPageHeaderComponent,
    LiassButtonComponent,
    LiassCardComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    LiassSearchableSelectComponent,
  ],
  templateUrl: './restaurants-workspace.page.html',
})
export class RestaurantsWorkspacePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly contextParams = toSignal(this.route.queryParamMap ?? of(convertToParamMap({})), {
    initialValue: this.route.snapshot.queryParamMap ?? convertToParamMap({}),
  });
  readonly mode = this.route.snapshot.data['restaurantPage'] as 'overview' | 'setup' | 'menu';
  readonly queries = inject(RestaurantsQueries);
  readonly caps = inject(RestaurantsCapabilities);
  private readonly api = inject(RestaurantsApi);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  readonly t = inject(TranslocoService);
  private readonly product = inject(ProductAccessState);
  readonly section = signal<RestaurantKind>(
    this.route.snapshot.data['restaurantSection'] ?? 'restaurant',
  );
  readonly pageKey = computed(() => (this.mode === 'setup' ? this.section() : this.mode));
  readonly headerAction = computed(() => {
    if (!this.root.data() || !this.allowed()) return null;
    if (this.mode === 'setup' && this.section() === 'restaurant')
      return this.caps.canManageSetup() ? 'RESTAURANTS.UI.EDIT' : null;
    if (
      this.mode !== 'overview' &&
      this.canCreate() &&
      !this.collection().pending &&
      !this.collection().failed
    )
      return 'RESTAURANTS.UX.ADD.' + this.kind();
    return null;
  });
  headerActionTriggered() {
    this.open(this.kind(), this.kind() === 'restaurant' ? this.root.data()! : undefined);
  }
  readonly sessionOutlet = inject(RestaurantOutletContext);
  // Explicit record links may target management objects without switching Active Outlet.
  readonly outletId = computed(
    () => this.contextParams().get('outlet') || this.sessionOutlet.id() || null,
  );
  readonly areaId = signal<string | null>(null);
  readonly categoryId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly deniedOrg = signal<string | null>(null);
  readonly availability = computed(() => this.product.availability('RESTAURANTS'));
  readonly allowed = computed(
    () =>
      this.availability() === 'AVAILABLE' &&
      this.caps.canRead() &&
      this.deniedOrg() !== this.queries.scope(),
  );
  readonly root = injectQuery(() => this.queries.get('restaurant', {}, this.allowed()));
  readonly locations = injectInfiniteQuery(() =>
    this.queries.list(
      'outlet',
      {},
      this.allowed() &&
        !!this.root.data() &&
        (this.mode !== 'setup' || this.section() !== 'restaurant'),
    ),
  );
  readonly outlets = computed(
    () => this.locations.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly outlet = computed(() => this.outlets().find((row) => row.id === this.outletId()));
  readonly site = computed<RestaurantContext>(() => ({ outletId: this.outletId() ?? undefined }));
  readonly areas = injectInfiniteQuery(() =>
    this.queries.list(
      'area',
      this.site(),
      this.allowed() &&
        !!this.outlet() &&
        (this.mode === 'overview' ||
          (this.mode === 'setup' && ['area', 'table'].includes(this.section()))),
    ),
  );
  readonly stationRows = computed(
    () => this.stations.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly areaRows = computed(() => this.areas.data()?.pages.flatMap((page) => page.items) ?? []);
  readonly area = computed(() => this.areaRows().find((row) => row.id === this.areaId()));
  readonly tableContext = computed<RestaurantContext>(() => ({
    ...this.site(),
    areaId: this.areaId() ?? undefined,
  }));
  readonly tables = injectInfiniteQuery(() =>
    this.queries.list(
      'table',
      this.tableContext(),
      this.allowed() && !!this.area() && this.mode === 'setup' && this.section() === 'table',
    ),
  );
  readonly stations = injectInfiniteQuery(() =>
    this.queries.list(
      'station',
      this.site(),
      this.allowed() && !!this.outlet() && (this.mode !== 'setup' || this.section() === 'station'),
    ),
  );
  readonly menu = injectQuery(() =>
    this.queries.get(
      'menu',
      this.site(),
      this.allowed() && this.caps.canReadMenu() && !!this.outlet() && this.mode === 'menu',
    ),
  );
  readonly categories = injectInfiniteQuery(() =>
    this.queries.list(
      'category',
      this.site(),
      this.allowed() && this.caps.canReadMenu() && !!this.menu.data(),
    ),
  );
  readonly categoryRows = computed(
    () => this.categories.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly categoryOptions = computed(() =>
    this.categoryRows().map((row) => ({ value: row.id, label: row.name })),
  );
  readonly category = computed(() =>
    this.categoryRows().find((row) => row.id === this.categoryId()),
  );
  readonly itemContext = computed<RestaurantContext>(() => ({
    ...this.site(),
    categoryId: this.categoryId() ?? undefined,
  }));
  readonly items = injectInfiniteQuery(() =>
    this.queries.list(
      'item',
      this.itemContext(),
      this.allowed() && this.caps.canReadMenu() && !!this.category(),
    ),
  );
  readonly outletOptions = computed(() =>
    this.outlets().map((row) => ({ value: row.id, label: row.name })),
  );
  readonly areaOptions = computed(() =>
    this.areaRows().map((row) => ({ value: row.id, label: row.name })),
  );
  readonly kind = computed<RestaurantKind>(() => (this.mode === 'menu' ? 'item' : this.section()));
  readonly collection = computed(() => {
    switch (this.kind()) {
      case 'outlet':
        return collectionState(this.locations);
      case 'area':
        return collectionState(this.areas);
      case 'table':
        return collectionState(this.tables);
      case 'station':
        return collectionState(this.stations);
      default:
        return collectionState(this.items);
    }
  });
  readonly rows = computed<RestaurantEntity[]>(() => this.collection().items);
  readonly search = signal('');
  readonly statusFilter = signal('ALL');
  readonly availabilityFilter = signal('ALL');
  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
  }
  readonly filteredRows = computed(() =>
    this.rows().filter(
      (row) =>
        (!this.search().trim() ||
          this.normalize(row.name).includes(this.normalize(this.search().trim()))) &&
        (this.statusFilter() === 'ALL' || row.isActive === (this.statusFilter() === 'ACTIVE')) &&
        (this.kind() !== 'item' ||
          this.availabilityFilter() === 'ALL' ||
          this.available(row) === (this.availabilityFilter() === 'AVAILABLE')),
    ),
  );
  readonly contextUnavailable = computed(
    () =>
      (this.locations.isSuccess() && !!this.outletId() && !this.outlet()) ||
      (this.section() === 'table' &&
        !!this.outlet() &&
        this.areas.isSuccess() &&
        !!this.areaId() &&
        !this.area()),
  );
  configurationContext(outletId: string | null = this.outletId(), areaId: string | null = null) {
    return { outlet: outletId, ...(areaId ? { area: areaId } : {}) };
  }
  private writeContext() {
    const url = this.router.parseUrl(this.router.url);
    url.queryParams = {
      ...url.queryParams,
      outlet: this.outletId(),
      area: this.section() === 'table' ? this.areaId() : null,
    };
    if (!url.queryParams['outlet']) delete url.queryParams['outlet'];
    if (!url.queryParams['area']) delete url.queryParams['area'];
    void this.router.navigateByUrl(this.router.serializeUrl(url));
  }
  readonly siteActive = computed(() => !!this.root.data()?.isActive && !!this.outlet()?.isActive);
  readonly canManage = computed(() =>
    this.mode === 'menu' ? this.caps.canManageMenu() : this.caps.canManageSetup(),
  );
  readonly canCreate = computed(() => {
    if (!this.allowed() || !this.canManage()) return false;
    if (this.kind() === 'restaurant') return true;
    if (this.kind() === 'outlet') return !!this.root.data()?.isActive;
    if (!this.siteActive()) return false;
    if (this.kind() === 'table') return !!this.area()?.isActive;
    if (this.mode === 'menu') return !!this.menu.data()?.isActive && !!this.category()?.isActive;
    return true;
  });
  constructor() {
    let targetOutlet = this.outletId();
    effect(() => {
      const next = this.outletId();
      if (next !== targetOutlet) {
        targetOutlet = next;
        this.categoryId.set(null);
        this.actionError.set(null);
      }
    });
    effect(() => {
      const params = this.contextParams();
      this.areaId.set(untracked(this.section) === 'table' ? params.get('area') : null);
    });
    let previous = this.queries.scope() + ':' + this.queries.userScope();
    effect(() => {
      const scope = this.queries.scope() + ':' + this.queries.userScope();
      if (previous !== scope) {
        previous = scope;
        this.areaId.set(null);
        this.categoryId.set(null);
        this.actionError.set(null);
        this.deniedOrg.set(null);
      }
    });
    effect(() => {
      if (!this.areaId() && this.areaRows().length)
        this.areaId.set((this.areaRows().find((row) => row.isActive) ?? this.areaRows()[0]).id);
    });
    effect(() => {
      if (!this.categoryId() && this.categoryRows().length)
        this.categoryId.set(
          (this.categoryRows().find((row) => row.isActive) ?? this.categoryRows()[0]).id,
        );
    });
  }
  selectArea(value: string | null) {
    this.areaId.set(value);
    this.actionError.set(null);
    this.writeContext();
  }
  selectCategory(value: string) {
    this.categoryId.set(value);
    this.actionError.set(null);
  }
  context(kind: RestaurantKind): RestaurantContext {
    return kind === 'restaurant' || kind === 'outlet'
      ? {}
      : kind === 'table'
        ? this.tableContext()
        : kind === 'item'
          ? this.itemContext()
          : this.site();
  }
  open(kind: RestaurantKind = this.kind(), entity?: RestaurantEntity) {
    const permitted = ['menu', 'category', 'item'].includes(kind)
      ? this.caps.canManageMenu()
      : this.caps.canManageSetup();
    if (!this.allowed() || !permitted || (entity && !entity.isActive && kind !== 'restaurant'))
      return;
    if (kind === 'outlet' && !this.root.data()?.isActive) return;
    if (!['restaurant', 'outlet'].includes(kind) && !this.siteActive()) return;
    if (kind === 'table' && !this.area()?.isActive) return;
    if (['category', 'item'].includes(kind) && !this.menu.data()?.isActive) return;
    if (kind === 'item' && !this.category()?.isActive) return;
    this.dialog.open(RestaurantEditorComponent, {
      width: '560px',
      maxWidth: 'calc(100vw - 24px)',
      disableClose: true,
      data: {
        org: this.queries.scope(),
        kind,
        context: this.context(kind),
        entity,
        currency: this.menu.data()?.currency,
        contextName: [
          this.outlet()?.name,
          kind === 'table' ? this.area()?.name : kind === 'item' ? this.category()?.name : null,
        ]
          .filter(Boolean)
          .join(' · '),
      },
    });
    // Outlet records are managed without changing the session context.
  }

  price(row: RestaurantEntity) {
    return 'price' in row
      ? restaurantPrice(row.price.amountMinor, row.price.currency, this.t.getActiveLang())
      : '';
  }
  stationName(row: RestaurantEntity) {
    if (!('preparationStationId' in row) || !row.preparationStationId)
      return this.t.translate('RESTAURANTS.UI.NO_STATION');
    return (
      this.stations
        .data()
        ?.pages.flatMap((page) => page.items)
        .find((station) => station.id === row.preparationStationId)?.name ??
      this.t.translate('RESTAURANTS.UI.STATION_ASSIGNED')
    );
  }
  tableCode(row: RestaurantEntity) {
    return 'code' in row ? row.code : row.name;
  }
  capacity(row: RestaurantEntity) {
    return 'capacity' in row ? row.capacity : null;
  }
  available(row: RestaurantEntity) {
    return 'availability' in row && row.availability === 'AVAILABLE';
  }
  reorder(row: RestaurantEntity) {
    return 'guestReorderEnabled' in row && row.guestReorderEnabled;
  }
  showQr(row: RestaurantEntity) {
    if (this.allowed() && this.caps.canManageSetup())
      this.dialog.open(RestaurantQrDialogComponent, {
        width: '520px',
        maxWidth: 'calc(100vw - 24px)',
        data: {
          org: this.queries.scope(),
          context: this.tableContext(),
          id: row.id,
          name: row.name,
          restaurantName: this.root.data()?.name,
          outletName: this.outletOptions().find((outlet) => outlet.value === this.site().outletId)
            ?.label,
        },
      });
  }
  deactivate(row: RestaurantEntity, kind: RestaurantListKind = this.kind() as RestaurantListKind) {
    if (!this.allowed() || !this.canManage() || !row.isActive) return;
    const org = this.queries.scope(),
      ctx = this.context(kind);
    this.dialog
      .open(LiassConfirmationDialogComponent, {
        maxWidth: 'calc(100vw - 24px)',
        data: {
          titleKey: 'RESTAURANTS.UI.DEACTIVATE',
          descriptionKey: 'RESTAURANTS.UI.DEACTIVATE_HELP',
          descriptionParams: { name: row.name },
          confirmKey: 'RESTAURANTS.UI.DEACTIVATE',
          cancelKey: 'RESTAURANTS.UI.CANCEL',
          tone: 'danger',
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed && this.queries.scope() === org)
          this.run(kind, ctx, () => this.api.deactivate(org, kind, ctx, row.id, row.version));
      });
  }
  async toggleAvailability(row: RestaurantEntity) {
    if (!this.allowed() || !this.canCreate() || this.busy() || !('availability' in row)) return;
    const org = this.queries.scope(),
      ctx = this.itemContext();
    await this.run('item', ctx, () =>
      this.api.availability(
        org,
        ctx,
        row.id,
        row.version,
        row.availability === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
      ),
    );
  }
  private async run(
    kind: RestaurantKind,
    ctx: RestaurantContext,
    operation: () => Promise<{ data: RestaurantEntity; message: string | null }>,
  ) {
    if (this.busy() || !this.allowed() || !this.canManage()) return;
    const org = this.queries.scope(),
      fence = { user: this.queries.userScope(), revision: this.queries.contextRevision() };
    const current = () =>
      org === this.queries.scope() &&
      fence.user === this.queries.userScope() &&
      fence.revision === this.queries.contextRevision();
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const result = await operation();
      await this.queries.confirmed(org, kind, ctx, result.data, false, fence);
      if (current())
        this.notification.success(result.message ?? this.t.translate('RESTAURANTS.UI.SAVED'));
    } catch (error) {
      if (!current()) return;
      if (org === this.queries.scope())
        this.actionError.set(restaurantError(error, (key) => this.t.translate(key)));
      if (error instanceof HttpErrorResponse && error.status === 409)
        await this.queries.changed(org, kind, ctx);
      if (error instanceof HttpErrorResponse && error.status === 403) {
        this.deniedOrg.set(org);
        await this.queries.denied(org);
      }
    } finally {
      this.busy.set(false);
    }
  }
  errorText(error: unknown) {
    return restaurantError(error, (key) => this.t.translate(key));
  }
  async refresh() {
    this.actionError.set(null);
    this.deniedOrg.set(null);
    await this.queries.denied(this.queries.scope());
    if (this.allowed()) await this.root.refetch();
  }
}
