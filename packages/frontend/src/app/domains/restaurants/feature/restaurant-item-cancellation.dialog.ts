import { Component, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectMutation } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantItemCancellation } from '../data-access/restaurant-item-cancellation';
import { RestaurantOrdersApi, ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { NotificationService } from '../../../core/notifications/notification.service';
import { safeMessageFromError } from '../../../core/notifications/notification-message';

export interface ItemCancellationDialogData {
  context: ServiceOrderContext;
  order: c.RestaurantOrder;
  line: c.RestaurantOrderItem;
  tableName?: string;
}
@Component({
  selector: 'liass-restaurant-item-cancellation-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule,
    LiassButtonComponent,
  ],
  template: ` <h2 mat-dialog-title>{{ 'RESTAURANTS.ITEM_CANCELLATION.TITLE' | transloco }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="space-y-4">
        <p class="break-words font-medium">
          {{ data.line.snapshot!.quantity }} × {{ data.line.snapshot!.name }}
        </p>
        @if (data.tableName) {
          <p class="break-words text-sm text-app-text-secondary">{{ data.tableName }}</p>
        }
        <p class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.ITEM_CANCELLATION.CONSEQUENCE' | transloco }}
        </p>
        <mat-form-field class="w-full" subscriptSizing="dynamic">
          <mat-label>{{ 'RESTAURANTS.ITEM_CANCELLATION.REASON' | transloco }}</mat-label>
          <textarea
            matInput
            formControlName="reason"
            maxlength="500"
            rows="3"
            cdkFocusInitial
          ></textarea>
          <mat-error>{{ 'RESTAURANTS.ITEM_CANCELLATION.REASON_INVALID' | transloco }}</mat-error>
        </mat-form-field>
        @if (error()) {
          <p role="alert" class="text-sm text-danger-600">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end" class="flex-wrap gap-2">
        <liass-button [disabled]="submitting()" (pressed)="ref.close()">{{
          'COMMON.ACTIONS.CLOSE' | transloco
        }}</liass-button>
        <liass-button
          buttonType="submit"
          tone="danger"
          variant="solid"
          icon="cancel"
          [disabled]="blocked()"
          [loading]="submitting()"
        >
          {{
            (uncertain()
              ? 'RESTAURANTS.ITEM_CANCELLATION.RETRY'
              : 'RESTAURANTS.ITEM_CANCELLATION.TITLE'
            ) | transloco
          }}
        </liass-button>
      </mat-dialog-actions>
    </form>`,
})
export class RestaurantItemCancellationDialog {
  readonly data = inject<ItemCancellationDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<RestaurantItemCancellationDialog>);
  private readonly flow = inject(RestaurantItemCancellation);
  private readonly api = inject(RestaurantOrdersApi);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly t = inject(TranslocoService);
  private readonly notifications = inject(NotificationService);
  readonly uncertain = signal(
    !!this.flow.pending(this.data.context, this.data.order.orderId, this.data.line.itemId),
  );
  readonly blocked = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    reason: new FormControl(
      this.flow.pending(this.data.context, this.data.order.orderId, this.data.line.itemId)
        ?.reason ?? '',
      {
        nonNullable: true,
        validators: [
          (control) =>
            c.CancelRestaurantItemRequestSchema.shape.reason.safeParse(control.value).success
              ? null
              : { reason: true },
        ],
      },
    ),
  });
  readonly mutation = injectMutation(() => ({
    retry: false,
    mutationFn: (reason: string) =>
      this.flow.cancel(this.data.context, this.data.order, this.data.line, reason),
  }));
  constructor() {
    if (this.uncertain()) this.form.disable();
    effect(() => {
      try {
        this.api.assertContext(this.data.context);
        if (!this.caps.canManageSetup()) this.ref.close();
      } catch {
        this.ref.close();
      }
    });
  }
  async submit() {
    if (this.submitting() || this.blocked()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set('');
    this.ref.disableClose = true;
    this.form.disable();
    try {
      const result = await this.mutation.mutateAsync(this.form.getRawValue().reason);
      this.api.assertContext(this.data.context);
      this.notifications.success(this.t.translate('RESTAURANTS.ITEM_CANCELLATION.SUCCESS'));
      this.ref.close(result);
    } catch (error) {
      try {
        this.api.assertContext(this.data.context);
      } catch {
        this.ref.close();
        return;
      }
      const definite =
        error instanceof HttpErrorResponse &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408;
      this.blocked.set(definite);
      this.uncertain.set(!definite);
      this.error.set(
        definite
          ? (safeMessageFromError(error) ??
              this.t.translate(
                error.status === 401 || error.status === 403
                  ? 'RESTAURANTS.ITEM_CANCELLATION.ACCESS'
                  : error.status === 409
                    ? 'RESTAURANTS.ITEM_CANCELLATION.CONFLICT'
                    : 'RESTAURANTS.ITEM_CANCELLATION.REJECTED',
              ))
          : this.t.translate('RESTAURANTS.ITEM_CANCELLATION.UNCERTAIN'),
      );
      this.notifications.error(this.error());
      await this.flow
        .reconcile(this.data.context, this.data.order.orderId, this.data.line)
        .catch(() => undefined);
    } finally {
      this.ref.disableClose = false;
      this.submitting.set(false);
    }
  }
}
