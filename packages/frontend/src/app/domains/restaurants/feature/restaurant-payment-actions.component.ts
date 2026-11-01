import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantCashPaymentRow } from '@liass-ohada/shared/restaurants';
export type PaymentAction = 'DETAIL' | 'BILL' | 'RECEIPT';
export function paymentActions(
  row: Pick<RestaurantCashPaymentRow, 'billSessionId' | 'receiptId'>,
): PaymentAction[] {
  return [
    'DETAIL',
    ...(row.billSessionId ? ['BILL' as const] : []),
    ...(row.billSessionId && row.receiptId ? ['RECEIPT' as const] : []),
  ];
}
@Component({
  selector: 'liass-restaurant-payment-actions',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, TranslocoModule],
  template: `@if (actions().length === 1) {
      <button
        mat-icon-button
        type="button"
        (click)="activate.emit('DETAIL')"
        [matTooltip]="'RESTAURANTS.PAYMENT_ACTIONS.DETAIL' | transloco"
        [attr.aria-label]="'RESTAURANTS.PAYMENT_ACTIONS.DETAIL' | transloco"
      >
        <mat-icon>visibility</mat-icon>
      </button>
    } @else {
      <button
        mat-icon-button
        type="button"
        [matMenuTriggerFor]="menu"
        [attr.aria-label]="'RESTAURANTS.CASH.ACTIONS' | transloco"
        [matTooltip]="'RESTAURANTS.CASH.ACTIONS' | transloco"
      >
        <mat-icon>more_vert</mat-icon>
      </button>
      <mat-menu #menu="matMenu" xPosition="before">
        @for (action of actions(); track action) {
          <button mat-menu-item (click)="activate.emit(action)">
            <mat-icon>{{ icons[action] }}</mat-icon
            >{{ 'RESTAURANTS.PAYMENT_ACTIONS.' + action | transloco }}
          </button>
        }
      </mat-menu>
    }`,
})
export class RestaurantPaymentActionsComponent {
  readonly row = input.required<RestaurantCashPaymentRow>();
  readonly activate = output<PaymentAction>();
  readonly actions = computed(() => paymentActions(this.row()));
  readonly icons = { DETAIL: 'visibility', BILL: 'receipt_long', RECEIPT: 'receipt' };
}
