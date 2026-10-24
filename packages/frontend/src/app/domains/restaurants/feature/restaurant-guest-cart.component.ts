import { RestaurantGuestSubmissionComponent } from './restaurant-guest-submission.component';
import { Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { GuestContextResponse } from '@liass-ohada/shared/restaurants';
import {
  GuestCartLine,
  GuestCartResult,
  RestaurantGuestCartStore,
} from '../data-access/restaurant-guest-cart.store';

type Context = Extract<GuestContextResponse, { state: 'FREE' | 'OCCUPIED' }>;

@Component({
  selector: 'liass-restaurant-guest-cart-dialog',
  imports: [MatButtonModule, MatDialogModule, TranslocoModule, RestaurantGuestSubmissionComponent],
  template: `
    <div
      class="max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-t-2xl bg-white shadow-xl dark:bg-slate-950 sm:rounded-2xl"
    >
      <div class="sticky top-0 z-10 border-b border-app-border bg-app-surface px-5 py-4 sm:px-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 mat-dialog-title class="!m-0 text-xl font-semibold">
              {{ 'RESTAURANTS.GUEST.CART.TITLE' | transloco }}
            </h2>
            <p class="mt-1 text-sm text-app-text-secondary" aria-live="polite">
              {{ 'RESTAURANTS.GUEST.CART.UNIT_COUNT' | transloco: { count: store.totalUnits() } }}
            </p>
          </div>
          <button mat-button type="button" class="min-h-11" (click)="close()">
            {{ 'RESTAURANTS.GUEST.CART.CLOSE' | transloco }}
          </button>
        </div>
      </div>

      <div class="space-y-5 px-5 py-5 sm:px-6">
        @if (store.contextStatus() === 'FREE') {
          <p role="status" class="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
            {{ 'RESTAURANTS.GUEST.CART.FREE_HELP' | transloco }}
          </p>
        } @else if (store.contextStatus() === 'VISIT_ENDED') {
          <div role="alert" class="rounded-lg border border-app-border p-4">
            <p class="font-medium">{{ 'RESTAURANTS.GUEST.CART.VISIT_ENDED' | transloco }}</p>
            <p class="mt-1 text-sm text-app-text-secondary">
              {{ 'RESTAURANTS.GUEST.CART.VISIT_ENDED_HELP' | transloco }}
            </p>
            <button mat-stroked-button class="mt-3 min-h-11" type="button" (click)="discard()">
              {{ 'RESTAURANTS.GUEST.CART.DISCARD' | transloco }}
            </button>
          </div>
        } @else if (store.contextStatus() === 'DIFFERENT_VISIT') {
          <div role="alert" class="rounded-lg border border-app-border p-4">
            <p class="font-medium">{{ 'RESTAURANTS.GUEST.CART.DIFFERENT_VISIT' | transloco }}</p>
            <p class="mt-1 text-sm text-app-text-secondary">
              {{ 'RESTAURANTS.GUEST.CART.DIFFERENT_VISIT_HELP' | transloco }}
            </p>
            <button mat-stroked-button class="mt-3 min-h-11" type="button" (click)="discard()">
              {{ 'RESTAURANTS.GUEST.CART.DISCARD' | transloco }}
            </button>
          </div>
        } @else if (store.contextStatus() === 'CONTEXT_UNAVAILABLE') {
          <p role="status" class="rounded-lg border border-app-border p-3 text-sm">
            {{ 'RESTAURANTS.GUEST.CART.LOCAL_ONLY' | transloco }}
          </p>
        }

        @for (line of store.lines(); track line.reference) {
          <article class="space-y-4 border-b border-app-border pb-5">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h3 class="break-words font-semibold leading-snug">{{ line.name }}</h3>
                <p class="mt-1 text-sm text-app-text-secondary">
                  {{ price(line.presentedAmountMinor, line.currency) }}
                </p>
              </div>
              <p class="shrink-0 font-semibold tabular-nums">
                {{ price(line.presentedAmountMinor * line.quantity, line.currency) }}
              </p>
            </div>

            @if (line.status === 'PRICE_CHANGED') {
              <div
                role="alert"
                aria-live="assertive"
                class="rounded-lg border border-warning-200 bg-warning-50 p-3 text-warning-700"
              >
                <p class="text-sm font-medium">
                  {{
                    'RESTAURANTS.GUEST.CART.PRICE_CHANGED'
                      | transloco
                        : {
                            old: price(line.presentedAmountMinor, line.currency),
                            current: price(line.proposedAmountMinor!, line.currency),
                          }
                  }}
                </p>
                <button
                  mat-stroked-button
                  class="mt-3 min-h-11"
                  type="button"
                  (click)="acceptPrice(line.reference)"
                >
                  {{ 'RESTAURANTS.GUEST.CART.ACCEPT_PRICE' | transloco }}
                </button>
              </div>
            } @else if (line.status === 'UNAVAILABLE') {
              <p role="status" class="text-sm font-semibold text-app-text-secondary">
                {{ 'RESTAURANTS.GUEST.CARTE.UNAVAILABLE' | transloco }}
              </p>
            } @else if (line.status === 'MISSING') {
              <p role="alert" class="text-sm font-semibold text-app-text-secondary">
                {{ 'RESTAURANTS.GUEST.CART.MISSING' | transloco }}
              </p>
            }

            <div class="flex flex-wrap items-center justify-between gap-3">
              <div
                class="flex items-center gap-1"
                role="group"
                [attr.aria-label]="quantityLabel(line)"
              >
                <button
                  mat-stroked-button
                  type="button"
                  class="!min-h-11 !min-w-11 !px-0 text-lg"
                  [disabled]="!store.canEdit() || line.quantity === 1"
                  [attr.aria-label]="minusLabel(line)"
                  (click)="change(line, line.quantity - 1)"
                >
                  −
                </button>
                <input
                  #quantityInput
                  class="h-11 w-14 rounded-lg border border-app-border bg-app-surface text-center font-semibold tabular-nums"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  [disabled]="!store.canEdit()"
                  [value]="line.quantity"
                  [attr.aria-label]="quantityLabel(line)"
                  (blur)="commitQuantity(line, quantityInput)"
                  (keydown.enter)="commitQuantity(line, quantityInput); quantityInput.blur()"
                />
                <button
                  mat-stroked-button
                  type="button"
                  class="!min-h-11 !min-w-11 !px-0 text-lg"
                  [disabled]="!store.canEdit() || line.quantity === 20"
                  [attr.aria-label]="plusLabel(line)"
                  (click)="change(line, line.quantity + 1)"
                >
                  +
                </button>
              </div>
              <button mat-button type="button" class="min-h-11" (click)="remove(line.reference)">
                {{ 'RESTAURANTS.GUEST.CART.REMOVE' | transloco }}
              </button>
            </div>

            <div class="space-y-1.5">
              <label class="block text-sm font-medium" [for]="'cart-note-' + line.reference">
                {{ 'RESTAURANTS.GUEST.CART.NOTE' | transloco }}
              </label>
              <textarea
                [id]="'cart-note-' + line.reference"
                class="liass-focus-ring min-h-24 w-full resize-y rounded-lg border border-app-border bg-white px-3 py-2 text-base dark:bg-slate-950"
                rows="2"
                maxlength="250"
                [disabled]="!store.canEdit()"
                [value]="line.note"
                [attr.aria-describedby]="'cart-note-help-' + line.reference"
                (input)="note(line, $event)"
              ></textarea>
              <div
                class="flex justify-between gap-3 text-xs text-app-text-secondary"
                [id]="'cart-note-help-' + line.reference"
              >
                <span>{{ 'RESTAURANTS.GUEST.CART.NOTE_HINT' | transloco }}</span>
                <span>{{ line.note.length }}/250</span>
              </div>
            </div>
          </article>
        }

        @if (message()) {
          <p role="status" aria-live="polite" class="text-sm font-medium text-app-text-secondary">
            {{ 'RESTAURANTS.GUEST.CART.ERRORS.' + message() | transloco }}
          </p>
        }

        <div class="flex items-center justify-between gap-4 pb-2 text-lg font-semibold">
          <span>{{ 'RESTAURANTS.GUEST.CART.TOTAL' | transloco }}</span>
          <span class="tabular-nums">{{ price(store.totalAmountMinor(), store.currency()) }}</span>
        </div>
        <liass-restaurant-guest-submission [action]="true" />
      </div>
    </div>
  `,
})
export class RestaurantGuestCartDialogComponent {
  readonly store = inject(RestaurantGuestCartStore);
  private readonly dialogRef = inject(MatDialogRef<RestaurantGuestCartDialogComponent>);
  private readonly translation = inject(TranslocoService);
  readonly message = signal<GuestCartResult | ''>('');
  constructor() {
    effect(() => {
      if (!this.store.lines().length) this.dialogRef.close();
    });
  }

  close() {
    this.dialogRef.close();
  }
  discard() {
    this.store.discard();
    this.close();
  }
  change(line: GuestCartLine, quantity: number) {
    this.report(this.store.setQuantity(line.reference, quantity));
  }
  commitQuantity(line: GuestCartLine, input: HTMLInputElement) {
    const result = this.store.setQuantity(line.reference, Number(input.value));
    this.report(result);
    if (result !== 'OK') input.value = String(line.quantity);
  }
  note(line: GuestCartLine, event: Event) {
    this.report(this.store.setNote(line.reference, (event.target as HTMLTextAreaElement).value));
  }
  acceptPrice(reference: string) {
    this.store.acceptPrice(reference);
    this.message.set('');
  }
  remove(reference: string) {
    this.store.remove(reference);
    this.message.set('');
  }
  private report(result: GuestCartResult) {
    this.message.set(result === 'OK' ? '' : result);
  }
  quantityLabel(line: GuestCartLine) {
    return this.translation.translate('RESTAURANTS.GUEST.CART.QUANTITY_LABEL', {
      item: line.name,
    });
  }
  minusLabel(line: GuestCartLine) {
    return this.translation.translate('RESTAURANTS.GUEST.CART.DECREASE', { item: line.name });
  }
  plusLabel(line: GuestCartLine) {
    return this.translation.translate('RESTAURANTS.GUEST.CART.INCREASE', { item: line.name });
  }
  price(amount: number, currency: string) {
    const digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(this.translation.getActiveLang() || 'fr', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).format(amount / 10 ** digits);
  }
}

@Component({
  selector: 'liass-restaurant-guest-cart',
  host: { class: 'block' },
  imports: [MatButtonModule, TranslocoModule],
  template: `
    @if (store.totalUnits() > 0) {
      <div
        class="fixed inset-x-0 bottom-0 z-30 border-t border-app-border bg-app-surface/95 px-3 pt-3 shadow-lg backdrop-blur-sm [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div class="mx-auto max-w-2xl">
          <button
            #cartButton
            mat-flat-button
            type="button"
            class="!min-h-12 w-full !rounded-xl"
            (click)="open()"
            [attr.aria-label]="
              'RESTAURANTS.GUEST.CART.OPEN_LABEL' | transloco: { count: store.totalUnits() }
            "
          >
            {{ 'RESTAURANTS.GUEST.CART.OPEN' | transloco }} ·
            {{ 'RESTAURANTS.GUEST.CART.UNIT_COUNT' | transloco: { count: store.totalUnits() } }} ·
            {{ price() }}
          </button>
        </div>
      </div>
    }
  `,
})
export class RestaurantGuestCartComponent {
  readonly scope = input.required<string>();
  readonly context = input<Context | null>(null);
  readonly store = inject(RestaurantGuestCartStore);
  private readonly dialog = inject(MatDialog);
  private readonly translation = inject(TranslocoService);
  constructor() {
    effect(() => this.store.activate(this.scope(), this.context()));
  }

  open() {
    this.dialog.open(RestaurantGuestCartDialogComponent, {
      width: 'calc(100vw - 1rem)',
      maxWidth: '42rem',
      maxHeight: 'calc(100dvh - 1rem)',
      autoFocus: 'dialog',
      restoreFocus: true,
      position: { bottom: '0.5rem' },
      panelClass: 'guest-cart-panel',
      ariaLabel: this.translation.translate('RESTAURANTS.GUEST.CART.TITLE'),
    });
  }
  price() {
    const currency = this.store.currency();
    const digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(this.translation.getActiveLang() || 'fr', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).format(this.store.totalAmountMinor() / 10 ** digits);
  }
}
