import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectMutation } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import {
  RestaurantOrderAbandonment,
  definiteAbandonmentRejection,
} from '../data-access/restaurant-order-abandonment';
import { RestaurantOrdersApi, ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { NotificationService } from '../../../core/notifications/notification.service';
import { safeMessageFromError } from '../../../core/notifications/notification-message';

export interface OrderAbandonmentDialogData {
  context: ServiceOrderContext;
  order: c.RestaurantOrder;
  tableName?: string;
}
/** CANCEL_ORDER exposes one combined prerequisite error; never guess a more specific cause. */
export function abandonmentErrorKey(error: unknown) {
  if (!definiteAbandonmentRejection(error)) return 'UNCERTAIN';
  const body = error.error;
  const code = body?.error?.code ?? body?.code ?? body?.message?.code;
  if (error.status === 401 || error.status === 403) return 'ACCESS';
  if (code === 'RESTAURANTS_UNPAID_CLOSE') return 'PREREQUISITES';
  if (code === 'RESTAURANTS_IDEMPOTENCY_CONFLICT') return 'INTENT_CONFLICT';
  return error.status === 409 ? 'CONFLICT' : 'REJECTED';
}
@Component({
  selector: 'liass-restaurant-order-abandonment-dialog',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule,
    LiassButtonComponent,
  ],
  template: ` <h2 mat-dialog-title>{{ 'RESTAURANTS.ORDER_ABANDONMENT.TITLE' | transloco }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="space-y-4">
        <p class="break-words font-medium">
          {{ 'RESTAURANTS.SERVICE_ORDERS.ORDER' | transloco }}
          {{ data.order.createdAt | date: 'dd/MM HH:mm:ss' }}
        </p>
        @if (data.tableName) {
          <p class="break-words text-sm text-app-text-secondary">{{ data.tableName }}</p>
        }
        <p class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.ORDER_ABANDONMENT.CONSEQUENCE' | transloco }}
        </p>
        <mat-form-field class="w-full" subscriptSizing="dynamic">
          <mat-label>{{ 'RESTAURANTS.ITEM_CANCELLATION.REASON' | transloco }}</mat-label>
          <textarea
            matInput
            formControlName="reason"
            [attr.maxlength]="500"
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
          'COMMON.ACTIONS.CANCEL' | transloco
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
              ? 'RESTAURANTS.ORDER_ABANDONMENT.RETRY'
              : 'RESTAURANTS.ORDER_ABANDONMENT.TITLE'
            ) | transloco
          }}
        </liass-button>
      </mat-dialog-actions>
    </form>`,
})
export class RestaurantOrderAbandonmentDialog {
  readonly data = inject<OrderAbandonmentDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<RestaurantOrderAbandonmentDialog>);
  private readonly flow = inject(RestaurantOrderAbandonment);
  private readonly api = inject(RestaurantOrdersApi);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly t = inject(TranslocoService);
  private readonly notifications = inject(NotificationService);
  readonly uncertain = signal(!!this.flow.pending(this.data.context, this.data.order.orderId));
  readonly blocked = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    reason: new FormControl(
      this.flow.pending(this.data.context, this.data.order.orderId)?.reason ?? '',
      {
        nonNullable: true,
        validators: [
          (control) =>
            c.CancelRestaurantOrderRequestSchema.shape.reason.safeParse(control.value).success
              ? null
              : { reason: true },
        ],
      },
    ),
  });
  readonly mutation = injectMutation(() => ({
    retry: false,
    mutationFn: (reason: string) => this.flow.abandon(this.data.context, this.data.order, reason),
  }));
  constructor() {
    this.ref.disableClose = true;
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
    this.form.disable();
    try {
      const result = await this.mutation.mutateAsync(this.form.getRawValue().reason);
      this.api.assertContext(this.data.context);
      this.notifications.success(this.t.translate('RESTAURANTS.ORDER_ABANDONMENT.SUCCESS'));
      this.ref.close(result);
    } catch (error) {
      try {
        this.api.assertContext(this.data.context);
      } catch {
        this.ref.close();
        return;
      }
      const definite = definiteAbandonmentRejection(error);
      this.blocked.set(definite);
      this.uncertain.set(!definite);
      const key = abandonmentErrorKey(error);
      const safe = definite ? safeMessageFromError(error) : null;
      this.error.set(
        // Known command guards need abandonment wording, not generic closure copy.
        key === 'REJECTED' && safe && !/^[A-Z][A-Z0-9_]+$/.test(safe)
          ? safe
          : this.t.translate('RESTAURANTS.ORDER_ABANDONMENT.' + key),
      );
      this.notifications.error(this.error());
      await this.flow.reconcile(this.data.context, this.data.order.orderId).catch(() => undefined);
    } finally {
      this.submitting.set(false);
    }
  }
}
