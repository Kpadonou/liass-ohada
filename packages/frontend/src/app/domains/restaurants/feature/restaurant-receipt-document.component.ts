import { Component, ElementRef, inject, input } from '@angular/core';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { RestaurantReceiptPart, RestaurantReceiptSummary } from '@liass-ohada/shared/restaurants';
import { restaurantPrice } from '../utils/restaurant-money';
@Component({
  selector: 'liass-receipt-document',
  host: { class: 'block min-w-0' },
  imports: [TranslocoModule],
  template: ` <article
    class="receipt-document min-w-0 bg-app-surface p-4 sm:p-6"
    aria-labelledby="receipt-title"
  >
    <header class="mb-5 border-b border-app-border pb-4">
      <p class="break-words text-sm font-semibold">{{ summary().restaurantName }}</p>
      <p class="break-words text-sm text-app-text-secondary">{{ summary().outletName }}</p>
      <div class="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="receipt-title" class="text-xl font-semibold">
          {{ 'RESTAURANTS.RECEIPT.TITLE' | transloco }}
        </h1>
        <span class="text-xs text-app-text-secondary">{{
          'RESTAURANTS.RECEIPT.OPERATIONAL' | transloco
        }}</span>
      </div>
      <h2 class="mt-2 break-words font-medium">{{ summary().tableName }}</h2>
      <p class="mt-2 break-all text-xs">
        {{ 'RESTAURANTS.RECEIPT.REFERENCE' | transloco }}
        <span class="block break-all">{{ summary().receiptId }}</span>
      </p>
      <dl class="mt-2 grid gap-1 text-xs text-app-text-secondary">
        <div>
          <dt class="mr-1 inline">{{ 'RESTAURANTS.RECEIPT.OPENED' | transloco }}</dt>
          <dd class="inline">{{ date(summary().openedAt) }}</dd>
        </div>
        <div>
          <dt class="mr-1 inline">{{ 'RESTAURANTS.RECEIPT.CLOSED' | transloco }}</dt>
          <dd class="inline">{{ date(summary().closedAt) }}</dd>
        </div>
        <div>
          <dt class="mr-1 inline">{{ 'RESTAURANTS.RECEIPT.ISSUED' | transloco }}</dt>
          <dd class="inline">{{ date(summary().issuedAt) }}</dd>
        </div>
      </dl>
      <p class="mt-2 text-xs">
        {{ 'RESTAURANTS.RECEIPT.CURRENCY' | transloco }} : {{ summary().currency }}
      </p>
    </header>
    <section aria-labelledby="receipt-lines" role="list">
      <h2 id="receipt-lines" class="mb-2 text-sm font-semibold">
        {{ 'RESTAURANTS.RECEIPT.ARTICLES' | transloco }}
      </h2>
      @for (part of parts(); track part.number) {
        @if (part.content.kind === 'COMMERCIAL') {
          @for (line of part.content.lines; track line.orderId + line.itemId) {
            <div
              class="receipt-line border-b border-app-border py-2"
              role="listitem"
              [class.receipt-cancelled]="!!line.cancelledAt"
            >
              <div class="flex min-w-0 items-start justify-between gap-3">
                <p class="min-w-0 break-words text-sm">
                  <span class="font-medium"
                    >{{ line.snapshot.quantity }} × {{ line.snapshot.name }}</span
                  >
                </p>
                <span class="shrink-0 text-sm font-semibold tabular-nums">{{
                  money(line.netAmountMinor)
                }}</span>
              </div>
              <p class="text-xs text-app-text-secondary">
                {{ money(line.snapshot.unitPriceMinor) }} ·
                {{ 'RESTAURANTS.RECEIPT.UNIT' | transloco }}
              </p>
              @if (line.notes) {
                <p
                  class="receipt-note mt-1 whitespace-pre-wrap break-words text-xs text-app-text-secondary"
                >
                  {{ line.notes }}
                </p>
              }
              @if (line.cancelledAt) {
                <p class="mt-1 break-words text-xs">
                  <strong>{{ 'RESTAURANTS.RECEIPT.CANCELLED' | transloco }}</strong> ·
                  {{ money(line.snapshot.lineTotalMinor) }} — {{ line.cancellationReason }}
                </p>
              }
            </div>
          }
        }
      }
    </section>
    <section
      class="receipt-totals mt-5 border-t border-app-border pt-3"
      aria-labelledby="receipt-total"
    >
      <h2 id="receipt-total" class="flex justify-between gap-3 text-base font-semibold">
        <span>{{ 'RESTAURANTS.RECEIPT.TOTAL' | transloco }}</span
        ><span class="shrink-0 tabular-nums">{{ money(summary().dueMinor) }}</span>
      </h2>
      <p class="mt-1 flex justify-between gap-3 text-sm">
        <span>{{ 'RESTAURANTS.RECEIPT.PAID' | transloco }}</span
        ><span class="tabular-nums">{{ money(summary().paidMinor) }}</span>
      </p>
      <h3 class="mt-3 text-sm font-semibold">{{ 'RESTAURANTS.RECEIPT.SETTLEMENT' | transloco }}</h3>
      @for (method of methods; track method) {
        @if (summary().paidByMethodMinor[method]) {
          <p class="mt-1 flex justify-between gap-3 text-sm">
            <span>{{ 'RESTAURANTS.CHECKOUT.' + method | transloco }}</span
            ><span class="tabular-nums">{{ money(summary().paidByMethodMinor[method]) }}</span>
          </p>
        }
      }
    </section>
    @for (part of parts(); track part.number) {
      @if (part.content.kind === 'SETTLEMENT') {
        @for (payment of part.content.payments; track payment.paymentId) {
          <section class="receipt-line mt-3 border-t border-app-border pt-2 text-xs">
            <p class="flex justify-between gap-3">
              <strong>{{ 'RESTAURANTS.CHECKOUT.' + payment.method | transloco }}</strong
              ><span>{{ money(payment.appliedAmountMinor) }}</span>
            </p>
            <p class="text-app-text-secondary">{{ date(payment.committedAt) }}</p>
            @if (payment.cashTenderedMinor !== undefined) {
              <p>
                {{ 'RESTAURANTS.RECEIPT.TENDER' | transloco }} :
                {{ money(payment.cashTenderedMinor) }} ·
                {{ 'RESTAURANTS.RECEIPT.CHANGE' | transloco }} :
                {{ money(payment.changeMinor ?? 0) }}
              </p>
            }
            @if (payment.method !== 'CASH') {
              <p>{{ 'RESTAURANTS.RECEIPT.STAFF_CONFIRMED' | transloco }}</p>
            }
            @if (payment.externalReference) {
              <p class="break-all">
                {{ 'RESTAURANTS.RECEIPT.REFERENCE' | transloco }} : {{ payment.externalReference }}
              </p>
            }
          </section>
        }
      }
    }
  </article>`,
  styles: [
    `
      :host {
        overflow-wrap: anywhere;
      }
      .receipt-cancelled {
        color: var(--color-app-text-secondary);
      }
      .receipt-note {
        overflow-wrap: anywhere;
      }
      .receipt-totals,
      .receipt-line {
        break-inside: avoid;
      }
    `,
  ],
})
export class RestaurantReceiptDocument {
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly summary = input.required<RestaurantReceiptSummary>();
  readonly parts = input.required<RestaurantReceiptPart[]>();
  private readonly t = inject(TranslocoService);
  readonly methods = ['CASH', 'MOBILE_MONEY', 'CARD'] as const;
  lang() {
    return this.t.getActiveLang();
  }
  date(value: string) {
    return new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  }
  money(amount: number) {
    return restaurantPrice(amount, this.summary().currency, this.lang()).replaceAll(
      '\u202f',
      '\u00a0',
    );
  }
}
