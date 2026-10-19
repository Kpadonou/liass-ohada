import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { CaptureRestaurantPaymentRequestSchema } from '@liass-ohada/shared/restaurants';
import type {
  GuestSessionRead,
  RestaurantOrder,
  CaptureRestaurantPaymentRequest,
} from '@liass-ohada/shared/restaurants';
import { RestaurantCheckoutFlow } from '../data-access/restaurant-checkout-flow';
import { RestaurantOrdersApi, ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { checkoutAllocationProposal } from '../utils/restaurant-checkout';
import { minorInput, parseMinorInput, restaurantPrice } from '../utils/restaurant-money';
import { checkoutError } from '../utils/restaurant-checkout-error';
@Component({
  selector: 'liass-checkout-payment-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    TranslocoModule,
  ],
  template: ` <h2 mat-dialog-title>{{ 'RESTAURANTS.CHECKOUT.PAY' | transloco }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="space-y-3">
        <p>{{ data.session.tableName }} · {{ data.session.currency }}</p>
        <mat-form-field class="w-full"
          ><mat-label>{{ 'RESTAURANTS.CHECKOUT.METHOD' | transloco }}</mat-label>
          <mat-select formControlName="method">
            @for (method of methods; track method) {
              <mat-option [value]="method">{{
                'RESTAURANTS.CHECKOUT.' + method | transloco
              }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="w-full"
          ><mat-label>{{ 'RESTAURANTS.CHECKOUT.APPLIED' | transloco }}</mat-label
          ><input matInput inputmode="decimal" formControlName="amount"
        /></mat-form-field>
        @if (form.controls.method.value === 'CASH') {
          <mat-form-field class="w-full"
            ><mat-label>{{ 'RESTAURANTS.CHECKOUT.TENDER' | transloco }}</mat-label
            ><input matInput inputmode="decimal" formControlName="tender"
          /></mat-form-field>
          <p role="status" aria-live="polite" aria-atomic="true">
            {{ 'RESTAURANTS.CHECKOUT.CHANGE' | transloco }} : {{ change() }}
          </p>
        } @else {
          <p class="text-sm text-app-text-secondary">
            {{ 'RESTAURANTS.CHECKOUT.EXTERNAL_CONFIRM' | transloco }}
          </p>
        }
        <mat-form-field class="w-full"
          ><mat-label>{{ 'RESTAURANTS.CHECKOUT.REFERENCE' | transloco }}</mat-label
          ><input matInput formControlName="reference" maxlength="200"
        /></mat-form-field>
        <p class="text-sm text-app-text-secondary">
          {{
            (allocationCount() === 1
              ? 'RESTAURANTS.CHECKOUT.ALLOCATION_ONE'
              : 'RESTAURANTS.CHECKOUT.ALLOCATION_SUMMARY'
            ) | transloco: { count: allocationCount() }
          }}
        </p>
        @if (error()) {
          <p role="alert" class="text-app-error">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [disabled]="busy() || !!intent" (click)="ref.close()">
          {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
        </button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="busy() || form.invalid"
          [attr.aria-busy]="busy()"
        >
          {{
            (busy()
              ? 'RESTAURANTS.CHECKOUT.CAPTURING'
              : intent
                ? 'RESTAURANTS.CHECKOUT.RETRY'
                : 'RESTAURANTS.CHECKOUT.PAY'
            ) | transloco
          }}
        </button>
      </mat-dialog-actions>
    </form>`,
})
export class RestaurantCheckoutPaymentDialog {
  readonly data = inject<{
    ctx: ServiceOrderContext;
    session: GuestSessionRead;
    orders: RestaurantOrder[];
  }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<RestaurantCheckoutPaymentDialog>);
  private readonly ordersApi = inject(RestaurantOrdersApi);
  private readonly flow = inject(RestaurantCheckoutFlow);
  private readonly t = inject(TranslocoService);
  readonly methods = ['CASH', 'MOBILE_MONEY', 'CARD'] as const;
  readonly busy = signal(false);
  readonly error = signal('');
  intent: CaptureRestaurantPaymentRequest | undefined = this.flow.pendingPayment(this.data.ctx);
  readonly form = inject(FormBuilder).nonNullable.group({
    method: ['CASH' as (typeof this.methods)[number], Validators.required],
    amount: [
      minorInput(
        this.data.session.dueMinor - this.data.session.paidMinor - this.data.session.reservedMinor,
        this.data.session.currency,
      ),
      Validators.required,
    ],
    tender: [''],
    reference: [''],
  });
  constructor() {
    if (this.intent) this.form.disable();
    this.ref.disableClose = !!this.intent;
    effect(() => {
      try {
        this.ordersApi.assertContext(this.data.ctx);
      } catch {
        this.ref.close();
      }
    });
  }
  failure(error: unknown) {
    return checkoutError(error, (key) => this.t.translate(key));
  }
  allocationCount() {
    try {
      return checkoutAllocationProposal(
        this.data.orders,
        parseMinorInput(this.form.controls.amount.value, this.data.session.currency),
      ).length;
    } catch {
      return 0;
    }
  }
  change() {
    try {
      const currency = this.data.session.currency;
      const change =
        parseMinorInput(this.form.controls.tender.value, currency) -
        parseMinorInput(this.form.controls.amount.value, currency);
      return change >= 0 ? restaurantPrice(change, currency, this.t.getActiveLang()) : '—';
    } catch {
      return '—';
    }
  }
  async submit() {
    if (this.busy()) return;
    this.error.set('');
    try {
      if (!this.intent) {
        const value = this.form.getRawValue(),
          currency = this.data.session.currency;
        const applied = parseMinorInput(value.amount, currency);
        if (
          applied >
          this.data.session.dueMinor - this.data.session.paidMinor - this.data.session.reservedMinor
        )
          throw new Error('Invalid amount');
        const tender =
          value.method === 'CASH' ? parseMinorInput(value.tender, currency) : undefined;
        if (tender !== undefined && tender < applied) throw new Error('Invalid tender');
        this.intent = {
          clientRequestId: crypto.randomUUID(),
          expectedVersion: this.data.session.version,
          method: value.method,
          currency,
          allocations: checkoutAllocationProposal(this.data.orders, applied),
          ...(tender !== undefined ? { cashTenderedMinor: tender } : {}),
          ...(value.reference.trim() ? { externalReference: value.reference.trim() } : {}),
        };
      }
      this.intent = CaptureRestaurantPaymentRequestSchema.parse(this.intent);
      this.busy.set(true);
      this.ref.disableClose = true;
      this.form.disable();
      const result = await this.flow.capture(this.data.ctx, this.intent);
      this.ref.close({ result });
    } catch (error) {
      if (!this.busy()) {
        this.error.set(this.t.translate('RESTAURANTS.CHECKOUT.INVALID_AMOUNT'));
        this.intent = undefined;
        return;
      }
      const unresolved = this.flow.pendingPayment(this.data.ctx);
      if (!unresolved) {
        this.intent = undefined;
        this.ref.disableClose = false;
        // A rejected proposal must be rebuilt from refreshed summaries, never silently retried.
        this.ref.close({ error });
      } else
        this.error.set(
          this.failure(error) ?? this.t.translate('RESTAURANTS.CHECKOUT.RETRY_NOTICE'),
        );
    } finally {
      this.busy.set(false);
    }
  }
}
