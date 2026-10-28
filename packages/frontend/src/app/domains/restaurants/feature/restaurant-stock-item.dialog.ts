import { RestaurantPendingCreationComponent } from '../ui/restaurant-pending-creation.component';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { StockItemResponseData, StockUnit, StockUnitSchema } from '@liass-ohada/shared/restaurants';
import { HttpErrorResponse } from '@angular/common/http';
import { RestaurantInventoryQueries } from '../data-access/restaurant-inventory.queries';
import { InventoryContext } from '../data-access/restaurant-inventory.api';
import { inventoryError } from '../utils/inventory-errors';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
export interface StockItemDialogData {
  ctx: InventoryContext;
  item?: StockItemResponseData;
}
@Component({
  selector: 'liass-stock-item-dialog',
  imports: [
    A11yModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    TranslocoModule,
    LiassButtonComponent,
    RestaurantPendingCreationComponent,
  ],
  templateUrl: './restaurant-stock-item.dialog.html',
})
export class RestaurantStockItemDialog {
  readonly data = inject<StockItemDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RestaurantStockItemDialog>);
  readonly queries = inject(RestaurantInventoryQueries);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  readonly units = StockUnitSchema.options;
  readonly pending = signal(false);
  readonly conflict = signal(false);
  readonly error = signal<string | null>(null);
  readonly allowed = computed(() => this.queries.api.isCurrent(this.data.ctx));
  readonly form = new FormGroup({
    name: new FormControl(this.data.item?.name ?? '', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(200),
        (c) => (String(c.value).trim() ? null : { required: true }),
      ],
    }),
    unit: new FormControl<StockUnit>(this.data.item?.unit ?? 'UNIT', {
      nonNullable: true,
      validators: Validators.required,
    }),
    isActive: new FormControl(this.data.item?.isActive ?? true, { nonNullable: true }),
  });
  constructor() {
    if (this.data.item) this.form.controls.unit.disable();
    effect(() => {
      if (!this.allowed()) this.ref.close();
    });
  }
  cancel() {
    if (!this.pending()) this.ref.close();
  }
  async save() {
    if (this.form.invalid || this.pending() || !this.allowed() || this.conflict()) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    try {
      const value = this.form.getRawValue();
      const result = await this.queries.save(
        this.data.ctx,
        this.data.item?.id ?? null,
        this.data.item
          ? {
              expectedVersion: this.data.item.version,
              name: value.name.trim(),
              isActive: value.isActive,
            }
          : { name: value.name.trim(), unit: value.unit },
      );
      if (!this.allowed()) return;
      this.notification.success(result.message ?? this.t.translate('RESTAURANTS_INVENTORY.SAVED'));
      this.ref.close(result.data);
    } catch (error) {
      if (this.allowed()) {
        this.conflict.set(error instanceof HttpErrorResponse && error.status === 409);
        this.error.set(inventoryError(error, (k) => this.t.translate(k)));
        this.notification.error(this.error()!);
      }
    } finally {
      this.pending.set(false);
      this.ref.disableClose = false;
    }
  }
}
