import { Component, effect, inject, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { z } from 'zod';
import * as c from '@liass-ohada/shared/restaurants';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { RestaurantCorrectionsQueries } from '../data-access/restaurant-corrections.queries';
import { CashContext } from '../data-access/restaurant-cash.queries';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { parseMinorInput, restaurantPrice } from '../utils/restaurant-money';
import { correctionError } from '../utils/restaurant-correction-error';

export interface CorrectionDialogData {
  scope: CashContext;
  session: string;
  currency: string;
  creditability?: z.infer<typeof c.RestaurantCreditabilitySchema>;
  credit?: c.RestaurantCreditNote;
  remaining?: number;
  refunded?: number;
  openedAt?: string;
}
export function creditIntent(
  data: CorrectionDialogData,
  quantities: number[],
  reason: string,
  clientRequestId: string,
) {
  return c.CreateRestaurantCreditNoteRequestSchema.parse({
    clientRequestId,
    reason,
    lines: quantities.flatMap((quantity, index) =>
      quantity > 0
        ? [
            {
              orderId: data.creditability!.lines[index].orderId,
              itemId: data.creditability!.lines[index].itemId,
              quantity,
            },
          ]
        : [],
    ),
  });
}
@Component({
  selector: 'liass-restaurant-correction-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslocoModule,
    LiassButtonComponent,
  ],
  template: ` <h2 mat-dialog-title>
      {{
        (data.credit ? 'RESTAURANTS_CORRECTIONS.REFUND' : 'RESTAURANTS_CORRECTIONS.CREATE')
          | transloco
      }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="space-y-4">
        @if (data.credit; as credit) {
          <p class="break-words font-medium">{{ credit.creditNoteReference }}</p>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-3">
              <dt>{{ 'RESTAURANTS_CORRECTIONS.AMOUNT' | transloco }}</dt>
              <dd>{{ money(credit.amountMinor) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt>{{ 'RESTAURANTS_CORRECTIONS.REFUNDED' | transloco }}</dt>
              <dd>{{ money(data.refunded ?? 0) }}</dd>
            </div>
            <div class="flex justify-between gap-3 font-semibold">
              <dt>{{ 'RESTAURANTS_CORRECTIONS.REMAINING' | transloco }}</dt>
              <dd>{{ money(data.remaining ?? 0) }}</dd>
            </div>
          </dl>
          <mat-form-field class="w-full" subscriptSizing="dynamic"
            ><mat-label>{{ 'RESTAURANTS_CORRECTIONS.REFUND_AMOUNT' | transloco }}</mat-label
            ><input matInput inputmode="decimal" formControlName="amount" /><mat-error>{{
              refundAmountError() | transloco: { amount: money(data.remaining ?? 0) }
            }}</mat-error></mat-form-field
          >
          <mat-form-field class="w-full"
            ><mat-label>{{ 'RESTAURANTS_CORRECTIONS.METHOD' | transloco }}</mat-label
            ><mat-select formControlName="method">
              @for (method of methods; track method) {
                <mat-option [value]="method">{{
                  'RESTAURANTS.CHECKOUT.' + method | transloco
                }}</mat-option>
              }
            </mat-select></mat-form-field
          >
          @if (form.controls.method.value !== 'CASH') {
            <p class="text-sm text-app-text-secondary">
              {{ 'RESTAURANTS_CORRECTIONS.EXTERNAL_HELP' | transloco }}
            </p>
          }
          <mat-form-field class="w-full"
            ><mat-label>{{ 'RESTAURANTS_CORRECTIONS.EXTERNAL' | transloco }}</mat-label
            ><input matInput formControlName="externalReference" maxlength="200"
          /></mat-form-field>
          @if (data.openedAt) {
            <p class="text-sm text-app-text-secondary">
              {{ 'RESTAURANTS_CORRECTIONS.SESSION' | transloco }} · {{ date(data.openedAt!) }}
            </p>
          }
        } @else {
          <div formArrayName="quantities">
            @for (
              line of data.creditability!.lines;
              track line.sourceLineIdentity;
              let i = $index
            ) {
              <section class="space-y-2 border-b border-app-border py-3">
                <h3 class="break-words font-medium">{{ line.label }}</h3>
                <p class="text-sm text-app-text-secondary">
                  {{ 'RESTAURANTS_CORRECTIONS.ORIGINAL' | transloco }}:
                  {{ line.originalQuantity }} ·
                  {{ 'RESTAURANTS_CORRECTIONS.CREDITED' | transloco }}: {{ line.creditedQuantity }}
                </p>
                <p class="text-sm">
                  {{ 'RESTAURANTS_CORRECTIONS.QUANTITY_REMAINING' | transloco }}:
                  {{ line.remainingQuantity }} · {{ money(line.remainingAmountMinor) }} ·
                  {{ money(line.unitAmountMinor) }} /
                  {{ 'RESTAURANTS_CORRECTIONS.UNIT' | transloco }}
                </p>
                @if (line.remainingQuantity > 0) {
                  <mat-form-field class="w-full sm:w-48"
                    ><mat-label>{{ 'RESTAURANTS_CORRECTIONS.QUANTITY' | transloco }}</mat-label
                    ><input
                      matInput
                      type="number"
                      inputmode="numeric"
                      min="0"
                      [max]="line.remainingQuantity"
                      step="1"
                      [formControlName]="i"
                    /><mat-error>{{
                      'RESTAURANTS_CORRECTIONS.INVALID' | transloco
                    }}</mat-error></mat-form-field
                  >
                } @else {
                  <p class="text-sm text-app-text-secondary">
                    {{ 'RESTAURANTS_CORRECTIONS.EXHAUSTED' | transloco }}
                  </p>
                }
              </section>
            }
          </div>
          <mat-form-field class="w-full"
            ><mat-label>{{ 'RESTAURANTS_CORRECTIONS.REASON' | transloco }}</mat-label
            ><textarea matInput formControlName="reason" maxlength="500" rows="3"></textarea
            ><mat-error>{{
              'RESTAURANTS_CORRECTIONS.REQUIRED' | transloco
            }}</mat-error></mat-form-field
          >
          <p class="font-semibold tabular-nums">
            {{ 'RESTAURANTS_CORRECTIONS.AMOUNT' | transloco }}: {{ money(expected()) }}
          </p>
          <p class="text-sm text-app-text-secondary">
            {{ 'RESTAURANTS_CORRECTIONS.IMMUTABLE' | transloco }}
          </p>
        }
        @if (error()) {
          <p role="alert" class="text-sm text-danger-600">
            {{ error() | transloco: { amount: money(data.remaining ?? 0) } }}
          </p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <liass-button [disabled]="busy()" (pressed)="ref.close()">{{
          'COMMON.ACTIONS.CANCEL' | transloco
        }}</liass-button>
        <liass-button buttonType="submit" tone="brand" variant="solid" [loading]="busy()">{{
          'RESTAURANTS_CORRECTIONS.CONFIRM' | transloco
        }}</liass-button>
      </mat-dialog-actions>
    </form>`,
})
export class RestaurantCorrectionDialog {
  readonly data = inject<CorrectionDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<RestaurantCorrectionDialog>);
  private readonly api = inject(RestaurantCorrectionsQueries);
  private readonly t = inject(TranslocoService);
  private readonly cash = inject(RestaurantCashQueries);
  constructor() {
    if (this.data.credit)
      this.form.controls.amount.addValidators((control) => {
        try {
          const value = parseMinorInput(control.value, this.data.currency);
          return value <= 0
            ? { positive: true }
            : value > (this.data.remaining ?? 0)
              ? { remaining: true }
              : null;
        } catch {
          return { positive: true };
        }
      });
    effect(() => {
      if (JSON.stringify(this.cash.context()) !== JSON.stringify(this.data.scope)) this.ref.close();
    });
  }
  private requestId = crypto.randomUUID();
  private fingerprint = '';
  readonly methods = ['CASH', 'CARD', 'MOBILE_MONEY'] as const;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: this.data.credit ? [] : [Validators.required, Validators.maxLength(500)],
    }),
    quantities: new FormArray(
      (this.data.creditability?.lines ?? []).map(
        (line) =>
          new FormControl(0, {
            nonNullable: true,
            validators: [
              Validators.min(0),
              Validators.max(line.remainingQuantity),
              (control) => (Number.isSafeInteger(control.value) ? null : { integer: true }),
            ],
          }),
      ),
    ),
    amount: new FormControl('', { nonNullable: true }),
    method: new FormControl<'CASH' | 'CARD' | 'MOBILE_MONEY'>('CASH', { nonNullable: true }),
    externalReference: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(200)],
    }),
  });
  refundAmountError() {
    try {
      const amount = parseMinorInput(this.form.controls.amount.value, this.data.currency);
      return amount > (this.data.remaining ?? 0)
        ? 'RESTAURANTS_CORRECTIONS.REFUND_TOO_LARGE'
        : amount <= 0
          ? 'RESTAURANTS_CORRECTIONS.REFUND_POSITIVE'
          : 'RESTAURANTS_CORRECTIONS.REFUND_INVALID';
    } catch {
      return 'RESTAURANTS_CORRECTIONS.REFUND_POSITIVE';
    }
  }
  money(value: number) {
    return restaurantPrice(value, this.data.currency, this.t.getActiveLang());
  }
  date(value: string) {
    return new Intl.DateTimeFormat(this.t.getActiveLang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }
  expected() {
    const value = this.form.controls.quantities.getRawValue().reduce((sum, q, i) => {
      const line = this.data.creditability!.lines[i];
      return Number.isSafeInteger(q) && q > 0 && q <= line.remainingQuantity
        ? sum + BigInt(q) * BigInt(line.unitAmountMinor)
        : sum;
    }, 0n);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : 0;
  }
  async submit() {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    this.error.set('');
    if (this.form.invalid) {
      this.error.set(
        this.data.credit ? this.refundAmountError() : 'RESTAURANTS_CORRECTIONS.INVALID',
      );
      return;
    }
    let body: unknown;
    try {
      if (this.data.credit) {
        const amountMinor = parseMinorInput(this.form.controls.amount.value, this.data.currency);
        if (amountMinor <= 0 || amountMinor > (this.data.remaining ?? 0)) {
          this.form.controls.amount.setErrors({ refundAmount: true });
          return;
        }
        body = c.CreateRestaurantRefundRequestSchema.parse({
          clientRequestId: this.requestId,
          amountMinor,
          method: this.form.controls.method.value,
          ...(this.form.controls.externalReference.value.trim()
            ? { externalReference: this.form.controls.externalReference.value.trim() }
            : {}),
        });
      } else
        body = creditIntent(
          this.data,
          this.form.controls.quantities.getRawValue(),
          this.form.controls.reason.value,
          this.requestId,
        );
    } catch {
      this.error.set(
        this.data.credit ? this.refundAmountError() : 'RESTAURANTS_CORRECTIONS.INVALID',
      );
      return;
    }
    const fingerprint = JSON.stringify({ ...(body as object), clientRequestId: undefined });
    if (this.fingerprint && this.fingerprint !== fingerprint) this.requestId = crypto.randomUUID();
    this.fingerprint = fingerprint;
    body = { ...(body as object), clientRequestId: this.requestId };
    this.busy.set(true);
    this.ref.disableClose = true;
    this.form.disable();
    try {
      const result = this.data.credit
        ? await this.api.createRefund(this.data.scope, this.data.credit.creditNoteId, body)
        : await this.api.createCredit(this.data.scope, this.data.session, body);
      this.ref.close(result);
    } catch (error) {
      this.error.set(correctionError(error));
    } finally {
      this.busy.set(false);
      this.ref.disableClose = false;
      this.form.enable();
    }
  }
}
