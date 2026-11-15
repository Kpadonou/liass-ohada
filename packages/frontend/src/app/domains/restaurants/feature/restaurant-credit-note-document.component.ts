import { Component, ElementRef, effect, inject, input, signal } from '@angular/core';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { z } from 'zod';
import QRCode from 'qrcode';
import { RestaurantCreditNoteDetailResponseSchema, RestaurantFiscalResultResponse,
  RestaurantReceiptSummary } from '@liass-ohada/shared/restaurants';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { restaurantPrice } from '../utils/restaurant-money';

@Component({
  selector: 'liass-restaurant-credit-note-document',
  host: { class: 'block min-w-0' },
  imports: [TranslocoModule, LiassStatusChipComponent],
  template: `<article class="min-w-0 space-y-4 bg-app-surface p-4 sm:p-5">
    <header class="space-y-2 border-b border-app-border pb-4">
      <p class="break-words text-sm font-semibold">{{ summary().restaurantName }} · {{ summary().outletName }}</p>
      <h2 class="text-xl font-semibold">{{ 'RESTAURANTS_CORRECTIONS.DETAIL' | transloco }}</h2>
      <p class="break-all font-medium">{{ credit().data.creditNoteReference }}</p>
      <p class="text-2xl font-semibold tabular-nums">{{ money(credit().data.amountMinor) }}</p>
      <liass-status-chip tone="neutral" [label]="'RESTAURANTS_CORRECTIONS.VALIDATED' | transloco" />
      <p class="text-sm text-app-text-secondary">{{ date(credit().data.validatedAt) }} · {{ summary().tableName }}</p>
      @if (summary().customer; as customer) {
        <p class="break-words text-sm">{{ customer.name }} @if (customer.ifu) { · IFU {{ customer.ifu }} }</p>
      }
      <p class="break-all text-xs">{{ 'RESTAURANTS_CORRECTIONS.ORIGINAL_INVOICE' | transloco }} : {{ credit().data.finalBillId }}</p>
    </header>
    <section class="space-y-2">
      <h3 class="font-semibold">{{ 'RESTAURANTS_CORRECTIONS.REASON' | transloco }}</h3>
      <p class="whitespace-pre-wrap break-words text-sm">{{ credit().data.reason }}</p>
      <h3 class="font-semibold">{{ 'RESTAURANTS_CORRECTIONS.LINES' | transloco }}</h3>
      @for (line of credit().lines; track line.creditNoteLineId) {
        <div class="flex justify-between gap-3 border-b border-app-border py-2 text-sm">
          <span class="break-words">{{ line.creditedQuantity }} × {{ line.label }}</span>
          <span class="shrink-0 tabular-nums">{{ money(line.creditedAmountMinor) }}</span>
        </div>
      }
    </section>
    @if (fiscal(); as result) {
      <section class="space-y-2 border-t border-app-border pt-3">
        <h3 class="font-semibold">{{ 'RESTAURANTS.RECEIPT.FISCAL_TEST' | transloco }}</h3>
        <liass-status-chip size="sm" [tone]="result.status === 'CONFIRMED' ? 'success' : 'neutral'"
          [label]="'RESTAURANTS.RECEIPT.FISCAL_STATUS.' + result.status | transloco" />
        @if (result.originalFiscalReference) {
          <p class="break-all text-xs">{{ 'RESTAURANTS_CORRECTIONS.ORIGINAL_DGI' | transloco }} : {{ result.originalFiscalReference }}</p>
        }
        @if (result.securityElements; as security) {
          <dl class="grid gap-2 text-xs sm:grid-cols-2">
            <div><dt>{{ 'RESTAURANTS.RECEIPT.FISCAL_CODE' | transloco }}</dt><dd class="break-all font-medium">{{ security.codeMECeFDGI }}</dd></div>
            <div><dt>{{ 'RESTAURANTS.RECEIPT.FISCAL_NIM' | transloco }}</dt><dd class="break-all font-medium">{{ security.nim }}</dd></div>
            <div><dt>{{ 'RESTAURANTS.RECEIPT.FISCAL_COUNTERS' | transloco }}</dt><dd class="break-all font-medium">{{ security.counters }}</dd></div>
            <div><dt>{{ 'RESTAURANTS.RECEIPT.FISCAL_DATE' | transloco }}</dt><dd class="break-all font-medium">{{ security.dateTime }}</dd></div>
          </dl>
          @if (qrImage(); as qr) { <img [src]="qr" width="180" height="180"
            [alt]="'RESTAURANTS.RECEIPT.FISCAL_QR' | transloco" /> }
        }
      </section>
    }
  </article>`,
})
export class RestaurantCreditNoteDocument {
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly t = inject(TranslocoService);
  readonly summary = input.required<RestaurantReceiptSummary>();
  readonly credit = input.required<z.infer<typeof RestaurantCreditNoteDetailResponseSchema>>();
  readonly fiscal = input<RestaurantFiscalResultResponse | null>(null);
  readonly qrImage = signal<string | undefined>(undefined);
  private qrReady: Promise<void> = Promise.resolve();
  constructor() {
    effect((onCleanup) => {
      let current = true;
      onCleanup(() => { current = false; });
      this.qrImage.set(undefined);
      const code = this.fiscal()?.securityElements?.qrCode;
      this.qrReady = code ? QRCode.toDataURL(code, { width: 360, margin: 4,
        errorCorrectionLevel: 'M' }).then(value => { if (current) this.qrImage.set(value); }) : Promise.resolve();
      void this.qrReady.catch(() => undefined);
    });
  }
  async readyForPrint() { await this.qrReady; }
  money(value: number) { return restaurantPrice(value, this.summary().currency, this.t.getActiveLang()); }
  date(value: string) { return new Intl.DateTimeFormat(this.t.getActiveLang(), {
    dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
}
