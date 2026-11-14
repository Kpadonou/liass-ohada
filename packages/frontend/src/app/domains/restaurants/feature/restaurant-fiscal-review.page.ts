import { Component, computed, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';
import type {
  RestaurantFiscalResultResponse,
  RestaurantReceiptPart,
  RestaurantReceiptSummary,
} from '@liass-ohada/shared/restaurants';
import { RestaurantReceiptPrint } from '../data-access/restaurant-receipt-print';
import { RestaurantReceiptDocument } from './restaurant-receipt-document.component';

type ReviewState = 'CONFIRMED' | 'CREATED' | 'FAILED' | 'UNKNOWN_OUTCOME';
type Preview = 'screen' | 'thermal' | 'a4';

const invoiceId = '11111111-1111-4111-8111-111111111111';
const summary: RestaurantReceiptSummary = {
  receiptId: invoiceId,
  guestSessionId: '22222222-2222-4222-8222-222222222222',
  scopeKind: 'GUEST_SESSION',
  documentKind: 'OPERATIONAL_RECEIPT',
  schemaVersion: 1,
  restaurantName: 'Atelier Resto — Démonstration',
  outletName: 'Établissement Porto-Novo',
  tableName: 'Table Terrasse 12 — Commande avec libellés longs',
  openedAt: '2026-11-14T08:15:00.000Z',
  closedAt: '2026-11-14T09:42:00.000Z',
  issuedAt: '2026-11-14T09:43:00.000Z',
  currency: 'XOF',
  dueMinor: 29400,
  paidMinor: 29400,
  paidByMethodMinor: { CASH: 15000, MOBILE_MONEY: 14400, CARD: 0 },
  partCount: 1,
  commercialPartCount: 1,
  settlementPartCount: 0,
  lineCount: 3,
  paymentCount: 2,
  digest: 'a'.repeat(64),
};
const parts: RestaurantReceiptPart[] = [
  {
    number: 1,
    previousDigest: '0'.repeat(64),
    digest: 'a'.repeat(64),
    content: {
      kind: 'COMMERCIAL',
      lines: [
        {
          orderId: '33333333-3333-4333-8333-333333333333',
          itemId: '44444444-4444-4444-8444-444444444444',
          netAmountMinor: 17700,
          notes: 'Cuisson à point, sauce servie séparément.',
          snapshot: {
            menuItemId: '55555555-5555-4555-8555-555555555555',
            menuId: '66666666-6666-4666-8666-666666666666',
            categoryId: '77777777-7777-4777-8777-777777777777',
            itemVersion: 1,
            categoryVersion: 1,
            menuVersion: 1,
            name: 'Poisson braisé, attiéké et légumes de saison',
            quantity: 1.5,
            unitPriceMinor: 11800,
            grossMinor: 17700,
            subtotalMinor: 15000,
            discountMinor: 0,
            taxMinor: 2700,
            lineTotalMinor: 17700,
            currency: 'XOF',
            acceptedAt: '2026-11-14T08:20:00.000Z',
            submissionId: '88888888-8888-4888-8888-888888888888',
          },
        },
        {
          orderId: '33333333-3333-4333-8333-333333333333',
          itemId: '99999999-9999-4999-8999-999999999999',
          netAmountMinor: 7200,
          snapshot: {
            menuItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            menuId: '66666666-6666-4666-8666-666666666666',
            categoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            itemVersion: 1,
            categoryVersion: 1,
            menuVersion: 1,
            name: 'Jus de bissap maison — formule exonérée',
            quantity: 3,
            unitPriceMinor: 2400,
            grossMinor: 7200,
            subtotalMinor: 7200,
            discountMinor: 0,
            taxMinor: 0,
            lineTotalMinor: 7200,
            currency: 'XOF',
            acceptedAt: '2026-11-14T08:21:00.000Z',
            submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          },
        },
        {
          orderId: '33333333-3333-4333-8333-333333333333',
          itemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          netAmountMinor: 4500,
          snapshot: {
            menuItemId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            menuId: '66666666-6666-4666-8666-666666666666',
            categoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            itemVersion: 1,
            categoryVersion: 1,
            menuVersion: 1,
            name: 'Dessert coco',
            quantity: 2.25,
            unitPriceMinor: 2000,
            grossMinor: 4500,
            subtotalMinor: 4500,
            discountMinor: 0,
            taxMinor: 0,
            lineTotalMinor: 4500,
            currency: 'XOF',
            acceptedAt: '2026-11-14T08:22:00.000Z',
            submissionId: '12121212-1212-4212-8212-121212121212',
          },
        },
      ],
    },
  },
];

@Component({
  selector: 'liass-restaurant-fiscal-review',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    TranslocoModule,
    RestaurantReceiptDocument,
  ],
  template: `
    <main class="min-h-screen bg-app-bg p-3 sm:p-6">
      <header class="mx-auto mb-5 max-w-6xl border-b border-app-border pb-4">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
          {{ 'RESTAURANTS.FISCAL_REVIEW.EYEBROW' | transloco }}
        </p>
        <h1 class="mt-1 text-2xl font-semibold text-app-text">
          {{ 'RESTAURANTS.FISCAL_REVIEW.TITLE' | transloco }}
        </h1>
        <p class="mt-1 max-w-3xl text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.FISCAL_REVIEW.DESCRIPTION' | transloco }}
        </p>
      </header>
      <section
        class="mx-auto mb-5 flex max-w-6xl flex-wrap items-end justify-between gap-3 rounded-app-card border border-app-border bg-app-surface p-3"
      >
        <div class="flex flex-wrap gap-3">
          <div>
            <p class="mb-1 text-xs font-medium text-app-text-secondary">
              {{ 'RESTAURANTS.FISCAL_REVIEW.STATE' | transloco }}
            </p>
            <mat-button-toggle-group
              class="review-state-toggle"
              [value]="state()"
              (change)="state.set($event.value)"
              [attr.aria-label]="'RESTAURANTS.FISCAL_REVIEW.STATE' | transloco"
            >
              <mat-button-toggle value="CONFIRMED">{{
                'RESTAURANTS.FISCAL_REVIEW.CONFIRMED' | transloco
              }}</mat-button-toggle>
              <mat-button-toggle value="CREATED">{{
                'RESTAURANTS.FISCAL_REVIEW.PENDING' | transloco
              }}</mat-button-toggle>
              <mat-button-toggle value="FAILED">{{
                'RESTAURANTS.FISCAL_REVIEW.FAILED' | transloco
              }}</mat-button-toggle>
              <mat-button-toggle value="UNKNOWN_OUTCOME">{{
                'RESTAURANTS.FISCAL_REVIEW.UNCERTAIN' | transloco
              }}</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
          <div>
            <p class="mb-1 text-xs font-medium text-app-text-secondary">
              {{ 'RESTAURANTS.FISCAL_REVIEW.PREVIEW' | transloco }}
            </p>
            <mat-button-toggle-group
              [value]="preview()"
              (change)="preview.set($event.value)"
              [attr.aria-label]="'RESTAURANTS.FISCAL_REVIEW.PREVIEW' | transloco"
            >
              <mat-button-toggle value="screen">{{
                'RESTAURANTS.FISCAL_REVIEW.SCREEN' | transloco
              }}</mat-button-toggle>
              <mat-button-toggle value="thermal">{{
                'RESTAURANTS.FISCAL_REVIEW.THERMAL' | transloco
              }}</mat-button-toggle>
              <mat-button-toggle value="a4">A4</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button mat-stroked-button type="button" (click)="print('thermal')">
            <mat-icon>receipt_long</mat-icon
            >{{ 'RESTAURANTS.FISCAL_REVIEW.PRINT_THERMAL' | transloco }}
          </button>
          <button mat-flat-button type="button" (click)="print('a4')">
            <mat-icon>print</mat-icon>{{ 'RESTAURANTS.FISCAL_REVIEW.PRINT_A4' | transloco }}
          </button>
        </div>
      </section>
      <div
        class="mx-auto overflow-auto pb-8"
        [class.max-w-2xl]="preview() === 'screen'"
        [class.max-w-[80mm]]="preview() === 'thermal'"
        [class.max-w-[210mm]]="preview() === 'a4'"
      >
        <div
          class="rounded-app-card border border-app-border bg-app-surface shadow-app-card"
          [class.fiscal-review-thermal]="preview() === 'thermal'"
          [class.fiscal-review-a4]="preview() === 'a4'"
        >
          <liass-receipt-document [summary]="summary" [parts]="parts" [fiscal]="fiscal()" />
        </div>
      </div>
    </main>
  `,
  styles: [
    `
      .fiscal-review-thermal {
        width: 80mm;
        min-width: 80mm;
      }
      .fiscal-review-a4 {
        width: 210mm;
        min-height: 297mm;
      }
      .fiscal-review-thermal ::ng-deep .fiscal-security-list {
        grid-template-columns: minmax(0, 1fr);
      }
      @media (max-width: 420px) {
        mat-button-toggle-group {
          max-width: calc(100vw - 3rem);
          overflow-x: auto;
        }
        .review-state-toggle {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          width: calc(100vw - 3rem);
          overflow: hidden;
        }
        .review-state-toggle mat-button-toggle {
          min-width: 0;
        }
        .review-state-toggle ::ng-deep .mat-button-toggle-button {
          width: 100%;
        }
        .review-state-toggle ::ng-deep .mat-button-toggle-label-content {
          padding: 0 0.4rem;
          font-size: 0.75rem;
        }
        .fiscal-review-a4 {
          transform-origin: top left;
        }
      }
    `,
  ],
})
export class RestaurantFiscalReviewPage {
  readonly summary = summary;
  readonly parts = parts;
  readonly state = signal<ReviewState>('CONFIRMED');
  readonly preview = signal<Preview>('screen');
  readonly document = viewChild.required(RestaurantReceiptDocument);
  readonly fiscal = computed<RestaurantFiscalResultResponse>(() => {
    const status = this.state();
    const confirmed = status === 'CONFIRMED';
    return {
      invoiceId,
      environment: 'TEST',
      execution: 'REAL_TEST',
      status,
      confirmed,
      legallyNormalized: false,
      normalizedInvoice: confirmed ? summary : null,
      securityElements: confirmed
        ? {
            dateTime: '14/11/2026 10:43:18',
            qrCode: 'F;REM-SI-TEST;IFU-0202111111111;FV;TEST-2026-000042;29400',
            codeMECeFDGI: 'TEST-9A7F-4C21-88D0',
            counters: '000042 / 000042 FV',
            nim: 'TEST-NIM-REM-SI-001',
          }
        : null,
      total: 29400,
      uncertainOperation: status === 'UNKNOWN_OUTCOME' ? 'CONFIRM' : null,
      mutationRetryAllowed: false,
      resultAvailable: confirmed,
      evidenceOrigin: confirmed ? 'DGI_TEST' : null,
    };
  });
  constructor(private readonly printer: RestaurantReceiptPrint) {}
  async print(paper: 'thermal' | 'a4') {
    await this.document().readyForPrint();
    this.printer.print(this.document().element.nativeElement, paper);
  }
}
