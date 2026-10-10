import { toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import { HttpErrorResponse } from '@angular/common/http';
import {
  RestaurantContext,
  RestaurantEntity,
  RestaurantKind,
  createRequests,
  updateRequests,
} from '../data-access/restaurants-model';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { minorInput, parseMinorInput } from '../utils/restaurant-money';
import { restaurantError } from '../utils/restaurant-errors';
export interface RestaurantEditorData {
  org: string;
  kind: RestaurantKind;
  context: RestaurantContext;
  entity?: RestaurantEntity;
  currency?: string;
  contextName?: string;
}
@Component({
  selector: 'liass-restaurant-editor',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    TranslocoModule,
    LiassSearchableSelectComponent,
  ],
  templateUrl: './restaurant-editor.component.html',
})
export class RestaurantEditorComponent {
  readonly data = inject<RestaurantEditorData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RestaurantEditorComponent>);
  private readonly api = inject(RestaurantsApi);
  readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly notification = inject(NotificationService);
  private readonly t = inject(TranslocoService);
  private readonly fb = inject(FormBuilder);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  readonly accessDenied = signal(false);
  readonly conflict = signal(false);
  readonly refreshed = signal(false);
  readonly version = signal(this.data.entity?.version);
  private readonly requestId = crypto.randomUUID();
  private readonly entity = this.data.entity;
  readonly form = this.fb.group({
    name: [this.entity?.name ?? '', [Validators.required, Validators.maxLength(160)]],
    code: [
      'code' in (this.entity ?? {}) ? (this.entity as { code: string }).code : '',
      this.data.kind === 'table'
        ? [Validators.required, Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/)]
        : [],
    ],
    capacity: [
      'capacity' in (this.entity ?? {})
        ? String((this.entity as { capacity: number }).capacity)
        : '',
    ],
    policy: [
      'guestOrderingPolicy' in (this.entity ?? {})
        ? (this.entity as { guestOrderingPolicy: string }).guestOrderingPolicy
        : 'STAFF_APPROVAL',
    ],
    active: [this.entity?.isActive ?? true],
    currency: [this.data.currency ?? 'XOF', [Validators.pattern(/^[A-Z]{3}$/)]],
    price: [
      'price' in (this.entity ?? {})
        ? minorInput(
            (this.entity as { price: { amountMinor: number; currency: string } }).price.amountMinor,
            this.data.currency ?? 'XOF',
          )
        : '',
    ],
    availability: [
      'availability' in (this.entity ?? {})
        ? (this.entity as { availability: string }).availability
        : 'AVAILABLE',
    ],
    station: [
      'preparationStationId' in (this.entity ?? {})
        ? (this.entity as { preparationStationId: string }).preparationStationId
        : null,
    ],
    reorder: [
      'guestReorderEnabled' in (this.entity ?? {})
        ? (this.entity as { guestReorderEnabled: boolean }).guestReorderEnabled
        : false,
    ],
  });
  private originalValues = this.form.getRawValue();
  readonly latestName = signal<string | null>(null);
  readonly stations = injectInfiniteQuery(() =>
    this.queries.list(
      'station',
      { outletId: this.data.context.outletId },
      this.data.kind === 'item' && !!this.data.context.outletId && this.canManage(),
    ),
  );
  readonly stationId = toSignal(this.form.controls.station.valueChanges, {
    initialValue: this.form.controls.station.value,
  });
  readonly selectedStation = injectQuery(() =>
    this.queries.detail(
      'station',
      { outletId: this.data.context.outletId },
      this.stationId() ?? '',
      this.data.kind === 'item' && this.canManage() && !!this.stationId(),
    ),
  );
  readonly stationOptions = computed(() => {
    const rows = this.stations.data()?.pages.flatMap((page) => page.items) ?? [];
    const selected = this.selectedStation.data();
    if (selected && !rows.some((row) => row.id === selected.id)) rows.push(selected);
    return rows
      .filter((row) => row.isActive || row.id === this.stationId())
      .map((row) => ({
        label: row.name + (row.isActive ? '' : ` · ${this.t.translate('RESTAURANTS.UI.INACTIVE')}`),
        value: row.id,
      }));
  });

  constructor() {
    effect(() => {
      if (
        this.queries.scope() !== this.data.org ||
        this.access.availability('RESTAURANTS') === 'UNAVAILABLE'
      )
        this.ref.close();
    });
  }
  canManage() {
    return (
      !this.accessDenied() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      (['menu', 'category', 'item'].includes(this.data.kind)
        ? this.caps.canManageMenu()
        : this.caps.canManageSetup())
    );
  }
  async refreshConflict() {
    try {
      const current = await this.api.get(
        this.data.org,
        this.data.kind,
        this.data.context,
        this.data.entity?.id,
      );
      if (!current || (!current.isActive && this.data.kind !== 'restaurant')) {
        this.error.set(this.t.translate('RESTAURANTS.UI.ERRORS.PARENT'));
        return;
      }
      const entered = this.form.getRawValue(),
        baseline = this.originalValues;
      const fresh = {
        ...baseline,
        name: current.name,
        active: current.isActive,
        ...('guestOrderingPolicy' in current ? { policy: current.guestOrderingPolicy } : {}),
        ...('code' in current
          ? {
              code: current.code,
              capacity: current.capacity === undefined ? '' : String(current.capacity),
            }
          : {}),
        ...('price' in current
          ? {
              price: minorInput(current.price.amountMinor, current.price.currency),
              station: current.preparationStationId ?? null,
              reorder: current.guestReorderEnabled,
              availability: current.availability,
            }
          : {}),
      };
      const choose = <T>(before: T, value: T, newValue: T) => (value === before ? newValue : value);
      this.form.patchValue({
        name: choose(baseline.name, entered.name, fresh.name),
        code: choose(baseline.code, entered.code, fresh.code),
        capacity: choose(baseline.capacity, entered.capacity, fresh.capacity),
        policy: choose(baseline.policy, entered.policy, fresh.policy),
        active: choose(baseline.active, entered.active, fresh.active),
        currency: choose(baseline.currency, entered.currency, fresh.currency),
        price: choose(baseline.price, entered.price, fresh.price),
        availability: choose(baseline.availability, entered.availability, fresh.availability),
        station: choose(baseline.station, entered.station, fresh.station),
        reorder: choose(baseline.reorder, entered.reorder, fresh.reorder),
      });
      this.originalValues = fresh;
      this.latestName.set(current.name);
      this.version.set(current.version);
      this.refreshed.set(true);
    } catch (error) {
      this.error.set(restaurantError(error, (key) => this.t.translate(key)));
    }
  }
  async submit() {
    if (this.pending() || !this.canManage() || (this.conflict() && !this.refreshed())) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    let request: Record<string, unknown> = {
      name: v.name?.trim(),
      ...(this.entity ? { expectedVersion: this.version() } : { clientRequestId: this.requestId }),
    };
    if (this.data.kind === 'restaurant')
      request = {
        ...request,
        guestOrderingPolicy: v.policy,
        ...(this.entity ? { isActive: v.active } : {}),
      };
    if (this.data.kind === 'table') {
      request['code'] = v.code?.trim();
      if (v.capacity?.trim()) {
        const capacity = Number(v.capacity);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
          this.form.controls.capacity.setErrors({ invalid: true });
          return;
        }
        request['capacity'] = capacity;
      } else if (this.entity) request['capacity'] = null;
    }
    if (this.data.kind === 'menu' && !this.entity) request['currency'] = v.currency;
    if (this.data.kind === 'item') {
      try {
        request['price'] = {
          amountMinor: parseMinorInput(v.price ?? '', this.data.currency ?? 'XOF'),
          currency: this.data.currency,
        };
      } catch {
        this.form.controls.price.setErrors({ invalid: true });
        return;
      }
      request['guestReorderEnabled'] = v.reorder;
      if (v.station) request['preparationStationId'] = v.station;
      else if (this.entity) request['preparationStationId'] = null;
      if (!this.entity) request['availability'] = v.availability;
    }
    const parsed = (
      this.entity ? updateRequests[this.data.kind] : createRequests[this.data.kind]
    ).safeParse(request);
    if (!parsed.success) {
      this.error.set(this.t.translate('RESTAURANTS.UI.ERRORS.VALIDATION'));
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    try {
      const result = await this.api.save(
        this.data.org,
        this.data.kind,
        this.data.context,
        parsed.data,
        this.entity?.id,
      );
      await this.queries.changed(this.data.org, this.data.kind, this.data.context);
      if (this.queries.scope() === this.data.org) {
        this.notification.success(result.message ?? this.t.translate('RESTAURANTS.UI.SAVED'));
        this.ref.close(result.data);
      }
    } catch (error) {
      this.error.set(restaurantError(error, (key) => this.t.translate(key)));
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.conflict.set(!!this.entity);
        this.refreshed.set(false);
        await this.queries.changed(this.data.org, this.data.kind, this.data.context);
        if (this.entity) await this.refreshConflict();
      }
      if (error instanceof HttpErrorResponse && error.status === 403) {
        this.accessDenied.set(true);
        await this.queries.denied(this.data.org);
      }
    } finally {
      this.pending.set(false);
    }
  }
}
