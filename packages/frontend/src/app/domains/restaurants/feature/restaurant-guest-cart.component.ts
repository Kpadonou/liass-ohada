import { GuestIconComponent } from '../ui/guest-icon.component';
import { RestaurantGuestSubmissionComponent } from './restaurant-guest-submission.component';
import { Component, effect, inject, input, signal, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
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
  host: { class: 'block h-full min-h-0' },
  encapsulation: ViewEncapsulation.None,
  styles: `
    .guest-cart-panel {
      --mat-dialog-container-shape: 1.5rem 1.5rem 0 0;
    }
  `,
  imports: [
    GuestIconComponent,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule,
    RestaurantGuestSubmissionComponent,
  ],
  template: `
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-app-surface">
      <div class="shrink-0 px-4 pb-4 pt-3 sm:px-6">
        <div aria-hidden="true" class="mx-auto mb-5 h-1 w-10 rounded-full bg-app-border"></div>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 mat-dialog-title class="!m-0 !p-0 !text-2xl !font-bold">
              {{ 'RESTAURANTS.GUEST.CART.TITLE' | transloco }}
            </h2>
            <p class="mt-1 text-sm text-app-text-secondary" aria-live="polite">
              {{
                (store.totalUnits() === 1
                  ? 'RESTAURANTS.GUEST.CART.UNIT_COUNT_ONE'
                  : 'RESTAURANTS.GUEST.CART.UNIT_COUNT'
                ) | transloco: { count: store.totalUnits() }
              }}
            </p>
          </div>
          <button
            mat-icon-button
            type="button"
            class="!h-11 !w-11"
            (click)="close()"
            [attr.aria-label]="'RESTAURANTS.GUEST.CART.CLOSE' | transloco"
          >
            <liass-guest-icon name="close" class="h-6 w-6" />
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
        @if (
          ['FREE', 'ACTIVE_VISIT'].includes(store.contextStatus()) &&
          store.context()?.policy !== 'DISABLED'
        ) {
          <p
            class="flex items-center gap-3 rounded-app-panel bg-app-surface-muted p-3 text-sm font-medium"
          >
            <liass-guest-icon name="info" class="h-6 w-6 text-brand-700 dark:text-brand-300" />
            {{ 'RESTAURANTS.GUEST.CART.TABLE_HELP' | transloco }}
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
          <article class="space-y-3 border-b border-app-border pb-5">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h3 class="break-words font-semibold leading-snug">{{ line.name }}</h3>
              </div>
              <p class="shrink-0 font-semibold tabular-nums">
                {{ price(line.presentedAmountMinor * line.quantity, line.currency) }}
              </p>
            </div>

            @if (line.status === 'PRICE_CHANGED') {
              <div
                role="alert"
                aria-live="assertive"
                class="rounded-lg border border-warning-600/30 bg-warning-50 p-3 text-brand-900"
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
                class="flex items-center overflow-hidden rounded-app-control border border-brand-700 dark:border-brand-300"
                role="group"
                [attr.aria-label]="quantityLabel(line)"
              >
                <button
                  mat-button
                  type="button"
                  class="!min-h-11 !min-w-11 !rounded-none !px-0 text-lg liass-action-neutral"
                  [disabled]="!store.canEdit() || line.quantity === 1"
                  [attr.aria-label]="minusLabel(line)"
                  (click)="change(line, line.quantity - 1)"
                >
                  −
                </button>
                <input
                  #quantityInput
                  class="liass-focus-ring h-11 w-11 bg-app-surface text-center text-base font-semibold tabular-nums"
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
                  mat-button
                  type="button"
                  class="!min-h-11 !min-w-11 !rounded-none !px-0 text-lg liass-action-neutral"
                  [disabled]="!store.canEdit() || line.quantity === 20"
                  [attr.aria-label]="plusLabel(line)"
                  (click)="change(line, line.quantity + 1)"
                >
                  +
                </button>
              </div>
              <button
                mat-button
                type="button"
                class="!min-h-11 liass-action-neutral"
                (click)="remove(line.reference)"
              >
                <span class="flex items-center gap-1.5"
                  ><liass-guest-icon name="trash" class="h-4 w-4" />{{
                    'RESTAURANTS.GUEST.CART.REMOVE' | transloco
                  }}</span
                >
              </button>
            </div>

            <mat-form-field appearance="outline" class="w-full" subscriptSizing="dynamic">
              <mat-label>{{ 'RESTAURANTS.GUEST.CART.NOTE' | transloco }}</mat-label>
              <liass-guest-icon
                matPrefix
                name="note"
                class="mx-3 h-5 w-5 text-app-text-secondary"
              />
              <textarea
                matInput
                class="!text-base"
                [id]="'cart-note-' + line.reference"
                rows="1"
                maxlength="250"
                [disabled]="!store.canEdit()"
                [value]="line.note"
                (input)="note(line, $event)"
              ></textarea>
              <mat-hint>{{ 'RESTAURANTS.GUEST.CART.NOTE_HINT' | transloco }}</mat-hint>
              <mat-hint align="end">{{ line.note.length }}/250</mat-hint>
            </mat-form-field>
          </article>
        }

        @if (message()) {
          <p role="status" aria-live="polite" class="text-sm font-medium text-app-text-secondary">
            {{ 'RESTAURANTS.GUEST.CART.ERRORS.' + message() | transloco }}
          </p>
        }
      </div>
      <div
        class="shrink-0 space-y-3 rounded-t-[1.5rem] bg-app-surface-muted/70 px-4 pt-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] sm:px-6"
      >
        <div class="flex items-center justify-between gap-4 text-lg font-semibold">
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
  encapsulation: ViewEncapsulation.None,
  // Allow the composed Cart summary to span the Material button's content area.
  styles: `
    .guest-cart-entry .mdc-button__label {
      width: 100%;
      min-width: 0;
    }
  `,
  host: { class: 'block' },
  imports: [GuestIconComponent, MatButtonModule, TranslocoModule],
  template: `
    @if (store.totalUnits() > 0) {
      <div
        class="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-app-surface via-app-surface to-transparent px-3 pt-3 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div class="mx-auto max-w-[64rem]">
          <button
            #cartButton
            mat-flat-button
            type="button"
            class="guest-cart-entry !h-auto !min-h-20 w-full !rounded-[1.25rem] !px-4"
            (click)="open()"
            [attr.aria-label]="
              'RESTAURANTS.GUEST.CART.OPEN_LABEL'
                | transloco: { count: store.totalUnits(), total: price() }
            "
          >
            <span class="flex w-full items-center gap-3 py-3 text-left">
              <span class="relative shrink-0">
                <liass-guest-icon name="cart" class="h-7 w-7" />
                <span
                  class="absolute -right-1.5 -top-2 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-brand-100 px-1 text-xs font-semibold text-brand-900"
                  aria-hidden="true"
                  >{{ store.totalUnits() }}</span
                >
              </span>
              <span class="min-w-0 flex-1">
                <span class="block break-words text-sm font-semibold"
                  >{{
                    (store.totalUnits() === 1
                      ? 'RESTAURANTS.GUEST.CART.UNIT_COUNT_ONE'
                      : 'RESTAURANTS.GUEST.CART.UNIT_COUNT'
                    ) | transloco: { count: store.totalUnits() }
                  }}
                  · {{ price() }}</span
                >
                <span class="mt-0.5 block text-sm font-normal">{{
                  'RESTAURANTS.GUEST.CART.OPEN' | transloco
                }}</span>
              </span>
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-app-surface text-brand-700 dark:text-brand-300"
                ><liass-guest-icon name="chevron" class="h-5 w-5"
              /></span>
            </span>
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
      width: '100vw',
      maxWidth: '42rem',
      height: 'min(92dvh, 54rem)',
      maxHeight: '92dvh',
      autoFocus: 'dialog',
      restoreFocus: true,
      position: { bottom: '0' },
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
