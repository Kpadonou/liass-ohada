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
import { MenuItem } from '@liass-ohada/shared/restaurants';
import { RestaurantInventoryQueries } from '../data-access/restaurant-inventory.queries';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { inventoryError } from '../utils/inventory-errors';
import { stockQuantity } from '../utils/inventory-quantity';
import { HttpErrorResponse } from '@angular/common/http';
import {
  buildTrackingCommand,
  captureTrackingDraft,
  TrackingDraft,
  TrackingPreDispatchError,
} from '../utils/inventory-tracking-command';

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
    draft: TrackingDraft;
    prepared: NonNullable<ReturnType<typeof buildTrackingCommand>>;
    dispatched: boolean;
  };
  readonly diagnostic = signal<TrackingPreDispatchError | null>(null);
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
  capture(): TrackingDraft {
    if (this.intent) return this.intent.draft;
    try {
      if (this.menuItemId() && !this.query.isSuccess())
        throw new TrackingPreDispatchError('TRACKING_STATE_RESET');
      const v = this.form.getRawValue();
      const current = this.query.data();
      const unchanged =
        (this.menuItemId() && !this.editing() && current?.stockItem) ||
        (!v.enabled && !current?.stockItem);
      const mode = unchanged ? 'UNCHANGED' : !v.enabled ? 'REMOVE' : v.mode;
      if (mode === 'LINK' && !this.options().some((o) => o.value === v.stockItemId))
        throw new TrackingPreDispatchError('INVALID_LINK_TARGET');
      return captureTrackingDraft({
        context: this.ctx(),
        categoryId: this.category(),
        expectedVersion: current?.version ?? 0,
        clientRequestId: crypto.randomUUID(),
        mode,
        unit: v.unit,
        stockItemId: v.stockItemId,
      });
    } catch (error) {
      this.recordDiagnostic(error);
      this.error.set(this.t.translate('RESTAURANTS_TRACKING.SAVE_ERROR'));
      throw error;
    }
  }
  private recordDiagnostic(error: unknown) {
    this.diagnostic.set(
      error instanceof TrackingPreDispatchError
        ? error
        : new TrackingPreDispatchError('UNEXPECTED_PRE_DISPATCH_ERROR', error),
    );
  }
  async persist(saved: MenuItem, draft = this.capture()) {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set(null);
    this.diagnostic.set(null);
    let intent = this.intent;
    try {
      if (!this.allowed()) throw new HttpErrorResponse({ status: 403 });
      if (saved.outletId !== draft.context.outlet || saved.categoryId !== draft.categoryId)
        throw new TrackingPreDispatchError('TRACKING_CONTEXT_MISMATCH');
      if (saved.preparationStationId && ['CREATE', 'LINK'].includes(draft.mode))
        throw new TrackingPreDispatchError('TRACKING_CONTEXT_MISMATCH');
      const prepared = buildTrackingCommand(draft, saved.id);
      if (!prepared) return;
      if (
        intent &&
        (intent.prepared.menuItemId !== saved.id ||
          intent.draft.clientRequestId !== draft.clientRequestId)
      )
        throw new TrackingPreDispatchError('TRACKING_CONTEXT_MISMATCH');
      intent ??= { draft, prepared, dispatched: false };
      this.intent = intent;
      const attempt = intent;
      await this.queries.saveTracking(
        attempt.prepared.context,
        attempt.prepared.categoryId,
        attempt.prepared.menuItemId,
        attempt.prepared.command,
        () => {
          attempt.dispatched = true;
        },
      );
      this.intent = undefined;
      this.uncertain.set(false);
      this.editing.set(false);
      this.form.enable();
    } catch (error) {
      // Retain request identity across uncertain retries. Edits stay locked until resolved.
      const uncertain =
        !!intent?.dispatched &&
        !(
          error instanceof HttpErrorResponse &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        );
      this.uncertain.set(uncertain);
      if (!intent?.dispatched) this.recordDiagnostic(error);
      if (uncertain) this.form.disable();
      else {
        // A local failure can retry the same intent. A definitive rejection permits a new one.
        if (intent?.dispatched) this.intent = undefined;
        this.form.enable();
      }
      this.error.set(
        uncertain
          ? null
          : error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500
            ? inventoryError(error, (k) => this.t.translate(k))
            : this.t.translate('RESTAURANTS_TRACKING.SAVE_ERROR'),
      );
      throw error;
    } finally {
      this.pending.set(false);
    }
  }
}
