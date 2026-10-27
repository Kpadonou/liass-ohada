import { Component, computed, effect, inject, signal } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { ManualStockMovementRequest, StockItemResponseData } from '@liass-ohada/shared/restaurants';
import { RestaurantInventoryIntent } from '../data-access/restaurant-inventory-intent';
import { RestaurantInventoryQueries } from '../data-access/restaurant-inventory.queries';
import { InventoryContext } from '../data-access/restaurant-inventory.api';
import {
  positiveStockQuantity,
  stockQuantityValidator,
  discreteStockUnit,
} from '../utils/inventory-quantity';
import { inventoryError } from '../utils/inventory-errors';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
export type InventoryMovementAction = ManualStockMovementRequest['type'];
export interface StockMovementDialogData {
  ctx: InventoryContext;
  item: StockItemResponseData;
  type: InventoryMovementAction;
}
@Component({
  selector: 'liass-stock-movement-dialog',
  imports: [
    A11yModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    TranslocoModule,
    LiassButtonComponent,
  ],
  templateUrl: './restaurant-stock-movement.dialog.html',
})
export class RestaurantStockMovementDialog {
  readonly data = inject<StockMovementDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RestaurantStockMovementDialog>);
  private readonly intent = inject(RestaurantInventoryIntent);
  private readonly queries = inject(RestaurantInventoryQueries);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  readonly existing = this.intent.pending(this.data.ctx, this.data.item.id);
  readonly type = this.existing?.type ?? this.data.type;
  readonly discrete = discreteStockUnit(this.data.item.unit);
  readonly pending = signal(false);
  readonly uncertain = signal(!!this.existing);
  readonly error = signal<string | null>(null);
  readonly allowed = computed(() => this.queries.api.isCurrent(this.data.ctx));
  readonly form = new FormGroup({
    quantity: new FormControl(this.existing?.quantity.replace(/^[+-]/, '') ?? '', {
      nonNullable: true,
      validators: [Validators.required, stockQuantityValidator(this.data.item.unit)],
    }),
    direction: new FormControl<'INCREASE' | 'DECREASE'>(
      this.existing?.quantity.startsWith('-') ? 'DECREASE' : 'INCREASE',
      { nonNullable: true },
    ),
    reference: new FormControl(this.existing?.sourceReference ?? '', {
      nonNullable: true,
      validators: Validators.maxLength(200),
    }),
  });
  constructor() {
    if (this.existing) this.form.disable();
    effect(() => {
      if (!this.allowed()) this.ref.close();
    });
  }
  cancel() {
    if (!this.pending()) this.ref.close();
  }
  async submit() {
    if (this.pending() || !this.allowed()) return;
    if (!this.uncertain() && this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const quantity = positiveStockQuantity(value.quantity, this.data.item.unit);
    if (!quantity) return;
    this.pending.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    try {
      const result = await this.intent.submit(this.data.ctx, this.data.item.id, {
        type: this.type,
        quantity:
          this.type === 'ADJUSTMENT' && value.direction === 'DECREASE' ? '-' + quantity : quantity,
        ...(value.reference.trim() ? { sourceReference: value.reference.trim() } : {}),
      });
      if (!this.allowed()) return;
      this.notification.success(
        result.message ?? this.t.translate('RESTAURANTS_INVENTORY.MOVEMENT_SAVED'),
      );
      this.ref.close(result.data);
    } catch (error) {
      if (this.allowed()) {
        this.uncertain.set(!!this.intent.pending(this.data.ctx, this.data.item.id));
        if (this.uncertain()) this.form.disable();
        else this.form.enable();
        this.error.set(inventoryError(error, (k) => this.t.translate(k)));
      }
    } finally {
      this.pending.set(false);
      this.ref.disableClose = false;
    }
  }
}
