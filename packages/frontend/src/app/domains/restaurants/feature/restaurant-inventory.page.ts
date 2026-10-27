import { toSignal } from '@angular/core/rxjs-interop';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import { StockItemResponseData } from '@liass-ohada/shared/restaurants';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantInventoryQueries } from '../data-access/restaurant-inventory.queries';
import { stockQuantity } from '../utils/inventory-quantity';
import { inventoryError } from '../utils/inventory-errors';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { LiassTablePreferencesDialogComponent } from '../../../shared/ui/table-preferences/table-preferences-dialog.component';
import {
  loadTablePreferences,
  saveTablePreferences,
} from '../../../shared/ui/table-preferences/table-preferences.storage';
import { RestaurantStockItemDialog } from './restaurant-stock-item.dialog';
import {
  RestaurantStockMovementDialog,
  InventoryMovementAction,
} from './restaurant-stock-movement.dialog';

@Component({
  selector: 'liass-restaurant-inventory',
  host: { class: 'block' },
  imports: [
    FormsModule,
    LiassSearchableSelectComponent,
    TranslocoModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatSidenavModule,
    LiassPageHeaderComponent,
    LiassCardComponent,
    LiassSkeletonComponent,
    LiassStatusChipComponent,
    LiassButtonComponent,
  ],
  templateUrl: './restaurant-inventory.page.html',
})
export class RestaurantInventoryPage {
  readonly outlet = inject(RestaurantOutletContext);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  readonly queries = inject(RestaurantInventoryQueries);
  private readonly dialog = inject(MatDialog);
  private readonly t = inject(TranslocoService);
  private readonly language = toSignal(this.t.langChanges$, {
    initialValue: this.t.getActiveLang(),
  });
  private readonly dateFormatter = computed(
    () => new Intl.DateTimeFormat(this.language(), { dateStyle: 'medium', timeStyle: 'short' }),
  );
  date(value: string) {
    return this.dateFormatter().format(new Date(value));
  }
  readonly allowed = computed(
    () => this.caps.canManageInventory() && this.access.availability('RESTAURANTS') === 'AVAILABLE',
  );
  readonly ctx = computed(() => this.queries.api.context());
  readonly selected = linkedSignal({
    source: () => JSON.stringify(this.ctx()),
    computation: () => null as string | null,
  });
  readonly itemsQuery = injectInfiniteQuery(() => this.queries.items(this.ctx(), this.allowed()));
  readonly itemQuery = injectQuery(() =>
    this.queries.item(this.ctx(), this.selected() ?? '', this.allowed() && !!this.outlet.id()),
  );
  readonly historyQuery = injectInfiniteQuery(() =>
    this.queries.history(
      this.ctx(),
      this.selected() ?? '',
      this.allowed() && !!this.outlet.id() && this.itemQuery.isSuccess(),
    ),
  );
  readonly items = computed(() => [
    ...new Map(
      (this.itemsQuery.data()?.pages.flatMap((p) => p.items) ?? []).map((item) => [item.id, item]),
    ).values(),
  ]);
  readonly movements = computed(() =>
    [
      ...new Map(
        (this.historyQuery.data()?.pages.flatMap((p) => p.items) ?? []).map((m) => [m.id, m]),
      ).values(),
    ].sort((a, b) => `${b.createdAt}#${b.id}`.localeCompare(`${a.createdAt}#${a.id}`)),
  );
  readonly quantity = stockQuantity;
  readonly columns = ['NAME', 'UNIT', 'CURRENT', 'STATUS', 'UPDATED', 'ACTIONS'].map((id) => ({
    id,
    labelKey: 'RESTAURANTS_INVENTORY.' + id,
    required: !['UNIT', 'UPDATED'].includes(id),
  }));
  readonly visibleColumns = signal(loadTablePreferences('restaurants.inventory', this.columns));
  readonly outletOptions = computed(() =>
    this.outlet.outlets().map((item) => ({ value: item.id, label: item.name })),
  );
  actorLabel(id: string) {
    return this.t.translate(
      id === this.ctx().user ? 'RESTAURANTS_INVENTORY.YOU' : 'RESTAURANTS_INVENTORY.TEAM_MEMBER',
    );
  }
  preferences() {
    this.dialog
      .open(LiassTablePreferencesDialogComponent, {
        width: '540px',
        maxWidth: 'calc(100vw - 24px)',
        data: {
          tableId: 'restaurants.inventory',
          columns: this.columns,
          visibleColumnIds: this.visibleColumns(),
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result)
          this.visibleColumns.set(
            saveTablePreferences('restaurants.inventory', this.columns, result.visibleColumnIds),
          );
      });
  }
  readonly actions: InventoryMovementAction[] = ['RECEIPT', 'LOSS', 'ADJUSTMENT'];
  constructor() {
    this.outlet.use(inject(DestroyRef), inject(ActivatedRoute), () => this.allowed());
    effect(() => {
      if (!this.allowed()) this.selected.set(null);
    });
  }
  errorText(error: unknown) {
    return inventoryError(error, (k) => this.t.translate(k));
  }
  select(item: StockItemResponseData) {
    if (this.allowed()) this.selected.set(item.id);
  }
  edit(item?: StockItemResponseData) {
    const ctx = this.ctx();
    if (!this.queries.api.isCurrent(ctx)) return;
    this.dialog
      .open(RestaurantStockItemDialog, {
        width: '440px',
        maxWidth: 'calc(100vw - 24px)',
        data: { ctx, item },
      })
      .afterClosed()
      .subscribe((result: StockItemResponseData | undefined) => {
        if (result && this.queries.api.isCurrent(ctx)) this.selected.set(result.id);
      });
  }
  movement(type: InventoryMovementAction, item = this.itemQuery.data()) {
    const ctx = this.ctx();
    if (!item || !this.queries.api.isCurrent(ctx)) return;
    this.dialog.open(RestaurantStockMovementDialog, {
      width: '460px',
      maxWidth: 'calc(100vw - 24px)',
      data: { ctx, item, type },
    });
  }
}
