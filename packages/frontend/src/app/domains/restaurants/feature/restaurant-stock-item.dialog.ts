import { EditorRecoveryService } from '../../../core/dialogs/editor-recovery.service';
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
  initialValues?: { name: string; unit: StockUnit; isActive: boolean };
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
  private readonly recovery = inject(EditorRecoveryService);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  readonly units = StockUnitSchema.options;
  readonly pending = signal(false);
  readonly conflict = signal(false);
  readonly error = signal<string | null>(null);
  readonly allowed = computed(() => this.queries.api.isCurrent(this.data.ctx));
  readonly form = new FormGroup({
    name: new FormControl(this.data.initialValues?.name ?? this.data.item?.name ?? '', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(200),
        (c) => (String(c.value).trim() ? null : { required: true }),
      ],
    }),
    unit: new FormControl<StockUnit>(
      this.data.initialValues?.unit ?? this.data.item?.unit ?? 'UNIT',
      {
        nonNullable: true,
        validators: Validators.required,
      },
    ),
    isActive: new FormControl(
      this.data.initialValues?.isActive ?? this.data.item?.isActive ?? true,
      { nonNullable: true },
    ),
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
  private async review(initialValues: { name: string; unit: StockUnit; isActive: boolean }) {
    if (!this.queries.api.isCurrent(this.data.ctx)) return;
    try {
      const item = this.data.item
        ? await this.queries.api.item(this.data.ctx, this.data.item.id)
        : undefined;
      if (!this.queries.api.isCurrent(this.data.ctx)) return;
      this.recovery.open(RestaurantStockItemDialog, {
        width: '440px',
        maxWidth: 'calc(100vw - 24px)',
        data: {
          ctx: this.data.ctx,
          item,
          initialValues: {
            ...initialValues,
            isActive: item?.isActive ?? initialValues.isActive,
            unit: item?.unit ?? initialValues.unit,
          },
        },
      });
    } catch (error) {
      if (this.queries.api.isCurrent(this.data.ctx))
        this.notification.error(inventoryError(error, (key) => this.t.translate(key)));
    }
  }
  async save() {
    if (this.form.invalid || this.pending() || !this.allowed() || this.conflict()) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    const value = this.form.getRawValue();
    const earlyClose = !this.data.item || value.isActive === this.data.item.isActive;
    let detached = false;
    const onDispatched = () => {
      if (earlyClose && !detached) {
        detached = true;
        this.ref.close(); // No synthetic canonical result for afterClosed consumers.
      }
    };
    try {
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
        ...(earlyClose ? [onDispatched] : []),
      );
      if (!this.allowed()) return;
      if (detached) return;
      this.notification.success(result.message ?? this.t.translate('RESTAURANTS_INVENTORY.SAVED'));
      this.ref.close(result.data);
    } catch (error) {
      if (this.allowed()) {
        this.conflict.set(error instanceof HttpErrorResponse && error.status === 409);
        this.error.set(inventoryError(error, (k) => this.t.translate(k)));
        this.notification.error(
          this.error()!,
          detached &&
            (this.data.item ||
              (error instanceof HttpErrorResponse &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 408))
            ? {
                label: this.t.translate('RESTAURANTS.UI.REVIEW_EDIT'),
                run: () => {
                  void this.review(value);
                },
              }
            : undefined,
        );
      }
    } finally {
      this.pending.set(false);
      this.ref.disableClose = false;
    }
  }
}
