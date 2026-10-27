import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import {
  SaveInventoryTrackingRequest,
  RemoveInventoryTrackingRequest,
} from '@liass-ohada/shared/restaurants';
import { RestaurantInventoryQueries } from '../data-access/restaurant-inventory.queries';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { inventoryError } from '../utils/inventory-errors';
import { stockQuantity } from '../utils/inventory-quantity';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'liass-restaurant-item-tracking',
  imports: [
    ReactiveFormsModule,
    MatCheckboxModule,
    MatRadioModule,
    MatSelectModule,
    MatFormFieldModule,
    MatButtonModule,
    TranslocoModule,
    LiassSearchableSelectComponent,
    LiassStatusChipComponent,
  ],
  templateUrl: './restaurant-item-tracking.component.html',
})
export class RestaurantItemTrackingComponent {
  readonly outlet = input('');
  readonly category = input('');
  readonly menuItemId = input('');
  readonly name = input('');
  readonly station = input<string | null>(null);
  readonly allowed = input(false);
  private readonly queries = inject(RestaurantInventoryQueries);
  private readonly t = inject(TranslocoService);
  readonly ctx = computed(() => this.queries.api.context(this.outlet()));
  readonly query = injectQuery(() =>
    this.queries.tracking(this.ctx(), this.category(), this.menuItemId(), this.allowed()),
  );
  readonly editing = signal(false);
  readonly error = signal<string | null>(null);
  readonly pending = signal(false);
  readonly units = ['UNIT', 'BOTTLE', 'CAN', 'PACK'] as const;
  readonly quantity = stockQuantity;
  // Form values and unresolved command intent only; canonical state stays in TanStack.
  readonly form = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    mode: new FormControl<'CREATE' | 'LINK'>('CREATE', { nonNullable: true }),
    unit: new FormControl<(typeof this.units)[number]>('UNIT', { nonNullable: true }),
    stockItemId: new FormControl<string | null>(null),
  });
  readonly enabled = toSignal(this.form.controls.enabled.valueChanges, { initialValue: false });
  readonly mode = toSignal(this.form.controls.mode.valueChanges, { initialValue: 'CREATE' });
  readonly items = injectInfiniteQuery(() =>
    this.queries.items(
      this.ctx(),
      this.allowed() && this.enabled() && this.mode() === 'LINK' && !this.station(),
    ),
  );
  readonly options = computed(() =>
    (this.items.data()?.pages.flatMap((p) => p.items) ?? [])
      .filter((item) => item.isActive && this.units.some((unit) => unit === item.unit))
      .map((item) => ({
        value: item.id,
        label: `${item.name} — ${this.t.translate('RESTAURANTS_INVENTORY.UNITS.' + item.unit)}`,
      })),
  );
  private intent?: {
    key: string;
    command: SaveInventoryTrackingRequest | RemoveInventoryTrackingRequest;
  };
  readonly uncertain = signal(false);
  constructor() {
    effect(() => {
      if (this.station() && !this.query.data()?.stockItem && !this.uncertain())
        this.form.controls.enabled.setValue(false);
    });
  }
  validate() {
    if (this.menuItemId() && !this.query.isSuccess()) {
      this.error.set(this.t.translate('RESTAURANTS_TRACKING.LOAD_ERROR'));
      return false;
    }
    if (
      this.enabled() &&
      this.mode() === 'LINK' &&
      !this.intent &&
      !this.options().some((o) => o.value === this.form.controls.stockItemId.value) &&
      (this.editing() || !this.query.data()?.stockItem)
    ) {
      this.error.set(this.t.translate('RESTAURANTS_TRACKING.SELECT_REQUIRED'));
      return false;
    }
    return true;
  }
  edit() {
    this.form.controls.enabled.setValue(!!this.query.data()?.stockItem);
    this.form.controls.mode.setValue('LINK');
    this.form.controls.stockItemId.setValue(this.query.data()?.stockItem?.id ?? null);
    this.editing.set(true);
  }
  remove() {
    this.edit();
    this.form.controls.enabled.setValue(false);
  }
  async persist(menuItemId: string) {
    if (!this.allowed()) throw new HttpErrorResponse({ status: 403 });
    if (this.pending()) return;
    // An existing relationship is never silently changed by ordinary Menu metadata edits.
    if (this.menuItemId() && !this.editing() && this.query.data()?.stockItem) return;
    if (this.station()) {
      if (this.enabled() || (this.query.data()?.stockItem && !this.editing()))
        throw new Error(this.t.translate('RESTAURANTS_TRACKING.STATION_HINT'));
      if (!this.query.data()?.stockItem) return;
    }
    if (this.menuItemId() && !this.query.isSuccess())
      throw new Error(this.t.translate('RESTAURANTS_TRACKING.LOAD_ERROR'));
    const v = this.form.getRawValue();
    const current = this.query.data();
    if (!v.enabled && !current?.stockItem && !this.intent) return;
    const payload = {
      categoryId: this.category(),
      expectedVersion: current?.version ?? 0,
      ...(v.enabled
        ? v.mode === 'CREATE'
          ? { mode: 'CREATE' as const, unit: v.unit }
          : { mode: 'LINK' as const, stockItemId: v.stockItemId! }
        : {}),
    };
    if (
      v.enabled &&
      v.mode === 'LINK' &&
      !this.options().some((o) => o.value === v.stockItemId) &&
      !this.intent
    ) {
      this.error.set(this.t.translate('RESTAURANTS_TRACKING.SELECT_REQUIRED'));
      throw new Error(this.t.translate('RESTAURANTS_TRACKING.SELECT_REQUIRED'));
    }
    const key = JSON.stringify({ menuItemId, ...payload });
    if (!this.intent)
      this.intent = { key, command: { ...payload, clientRequestId: crypto.randomUUID() } };
    this.pending.set(true);
    try {
      await this.queries.saveTracking(this.ctx(), this.category(), menuItemId, this.intent.command);
      this.intent = undefined;
      this.uncertain.set(false);
      this.editing.set(false);
    } catch (error) {
      // Retain request identity across uncertain retries. Edits stay locked until resolved.
      const uncertain = !(
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      );
      this.uncertain.set(uncertain);
      if (uncertain) this.form.disable();
      else {
        this.intent = undefined;
        this.form.enable();
      }
      this.error.set(inventoryError(error, (k) => this.t.translate(k)));
      throw error;
    } finally {
      this.pending.set(false);
    }
  }
}
