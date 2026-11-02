import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import * as c from '@liass-ohada/shared/restaurants';
import { z } from 'zod';
import { RestaurantDocumentCollectionsQueries } from '../data-access/restaurant-document-collections.queries';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { RestaurantCorrectionsQueries } from '../data-access/restaurant-corrections.queries';
import { RestaurantReceiptApi } from '../data-access/restaurant-receipt.api';
import { RestaurantReceiptView } from './restaurant-receipt.page';
import {
  RestaurantCorrectionsComponent,
  correctionRole,
  refundContext,
} from './restaurant-corrections.component';
import { RestaurantCorrectionDialog } from './restaurant-correction.dialog';
import { AuthStore } from '../../identity/data-access/auth.store';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { restaurantPrice } from '../utils/restaurant-money';
import { documentDateBoundary } from '../utils/restaurant-document-date';
type InvoiceRow = z.infer<typeof c.RestaurantInvoiceCollectionRowSchema>;
type CreditRow = z.infer<typeof c.RestaurantCreditNoteCollectionRowSchema>;
type Row = InvoiceRow | CreditRow;
@Component({
  selector: 'liass-restaurant-document-collection',
  host: { class: 'block min-w-0' },
  imports: [
    NgTemplateOutlet,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatSidenavModule,
    TranslocoModule,
    LiassButtonComponent,
    LiassStatusChipComponent,
    LiassSkeletonComponent,
    RestaurantReceiptView,
    RestaurantCorrectionsComponent,
  ],
  template: `<mat-drawer-container
      [class]="selected() ? 'min-h-[75dvh] bg-transparent' : 'bg-transparent'"
      [hasBackdrop]="true"
    >
      <mat-drawer
        mode="over"
        position="end"
        [style.width]="mode() === 'credit' ? 'min(440px, 100%)' : 'min(640px, 100%)'"
        [opened]="!!selected()"
        (closedStart)="selected.set(null)"
        role="dialog"
        [attr.aria-label]="
          (mode() === 'credit' ? 'RESTAURANTS_CORRECTIONS.DETAIL' : 'RESTAURANTS_DOCUMENTS.DETAIL')
            | transloco
        "
      >
        <div [class]="mode() === 'credit' ? '' : 'space-y-4 p-4 sm:p-5'">
          @if (mode() !== 'credit') {
            <header class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold">
                {{
                  (mode() === 'credit'
                    ? 'RESTAURANTS_CORRECTIONS.DETAIL'
                    : 'RESTAURANTS_DOCUMENTS.DETAIL'
                  ) | transloco
                }}
              </h2>
              <liass-button
                size="icon"
                variant="ghost"
                icon="close"
                [ariaLabel]="'COMMON.ACTIONS.CLOSE' | transloco"
                (pressed)="selected.set(null)"
              />
            </header>
          }
          @if (selected(); as row) {
            @if (mode() === 'invoice') {
              <liass-receipt-view
                [ctx]="invoiceContext(row)"
                [expectedReceiptId]="row.invoiceId"
                [readOnly]="true"
              />
            } @else if (source.data(); as source) {
              <liass-restaurant-corrections
                [summary]="source.data"
                [initialCreditId]="credit(row).creditNoteId"
                [detailOnly]="true"
                [refundSummary]="credit(currentSelection()!)"
                (detailClosed)="selected.set(null)"
              />
            } @else if (source.isError()) {
              <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
            } @else {
              <liass-skeleton variant="block" />
            }
          }
        </div>
      </mat-drawer>
      <mat-drawer-content>
        <section class="space-y-3 pt-3">
          <div class="flex flex-wrap items-center gap-3">
            <mat-form-field
              appearance="outline"
              subscriptSizing="dynamic"
              class="w-full sm:max-w-sm"
              ><mat-icon matPrefix>search</mat-icon
              ><mat-label>{{ 'RESTAURANTS_DOCUMENTS.SEARCH' | transloco }}</mat-label
              ><input
                matInput
                type="search"
                [value]="searchInput()"
                (input)="changeSearch($any($event.target).value)"
              />
              @if (searchInput()) {
                <button
                  mat-icon-button
                  matSuffix
                  class="m-1.5"
                  (click)="clearSearch()"
                  [attr.aria-label]="'RESTAURANTS_DOCUMENTS.CLEAR' | transloco"
                >
                  <mat-icon>close</mat-icon>
                </button>
              }
            </mat-form-field>
            <button mat-stroked-button (click)="history.set(!history())">
              <mat-icon>date_range</mat-icon
              >{{
                (history() || !day()
                  ? 'RESTAURANTS_DOCUMENTS.HISTORY'
                  : 'RESTAURANTS_DOCUMENTS.ACTIVE_DAY'
                ) | transloco
              }}
            </button>
          </div>
          @if (history()) {
            <div class="flex flex-wrap items-start gap-3">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"
                ><mat-label>{{ 'RESTAURANTS_DOCUMENTS.FROM' | transloco }}</mat-label
                ><input
                  matInput
                  type="date"
                  [ngModel]="from()"
                  (ngModelChange)="from.set($event)" /></mat-form-field
              ><mat-form-field appearance="outline" subscriptSizing="dynamic"
                ><mat-label>{{ 'RESTAURANTS_DOCUMENTS.TO' | transloco }}</mat-label
                ><input matInput type="date" [ngModel]="to()" (ngModelChange)="to.set($event)"
              /></mat-form-field>
            </div>
          }
          @if (!validRange()) {
            <p role="alert" class="text-sm">
              {{ 'RESTAURANTS_DOCUMENTS.RANGE_ERROR' | transloco }}
            </p>
          }
          @if (queryPending()) {
            <liass-skeleton variant="block" />
          }
          @if (queryError()) {
            <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
            <button mat-button (click)="retry()">{{ 'RESTAURANTS.CASH.RETRY' | transloco }}</button>
          }
          <div class="hidden lg:block">
            <table
              class="liass-data-table w-full border-collapse text-left text-sm [&_th]:px-3 [&_th]:py-3 [&_td]:px-3 [&_td]:py-3"
            >
              <thead>
                <tr class="text-left">
                  <th>{{ 'RESTAURANTS_DOCUMENTS.DATE' | transloco }}</th>
                  <th>
                    {{
                      (kind() === 'invoices'
                        ? 'RESTAURANTS_DOCUMENTS.TECHNICAL_SHORT'
                        : 'RESTAURANTS_DOCUMENTS.REFERENCE'
                      ) | transloco
                    }}
                  </th>
                  @if (kind() === 'credit-notes') {
                    <th>{{ 'RESTAURANTS_DOCUMENTS.INVOICE' | transloco }}</th>
                  }
                  <th>{{ 'RESTAURANTS_DOCUMENTS.CONTEXT' | transloco }}</th>
                  <th class="text-right">{{ 'RESTAURANTS_DOCUMENTS.AMOUNT' | transloco }}</th>
                  @if (kind() === 'credit-notes') {
                    <th class="text-right">{{ 'RESTAURANTS_DOCUMENTS.REFUNDED' | transloco }}</th>
                    <th class="text-right">
                      {{ 'RESTAURANTS_DOCUMENTS.REMAINING' | transloco }}
                    </th>
                  }
                  <th>{{ 'RESTAURANTS_DOCUMENTS.STATUS' | transloco }}</th>
                  <th>{{ 'RESTAURANTS.CASH.ACTIONS' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track rowId(row)) {
                  <tr>
                    <td>{{ date(issued(row)) }}</td>
                    <td [title]="row.invoiceId">{{ reference(row) }}</td>
                    @if (kind() === 'credit-notes') {
                      <td [title]="row.invoiceId">{{ short(row.invoiceId) }}</td>
                    }
                    <td>{{ row.tableDisplayName }}</td>
                    <td class="text-right tabular-nums">{{ money(amount(row), row.currency) }}</td>
                    @if (kind() === 'credit-notes') {
                      <td class="text-right tabular-nums">
                        {{ money(credit(row).refundedMinor, row.currency) }}
                      </td>
                      <td class="text-right tabular-nums">
                        {{ money(credit(row).remainingRefundableMinor, row.currency) }}
                      </td>
                    }
                    <td>
                      <liass-status-chip
                        size="sm"
                        tone="neutral"
                        [label]="status(row) | transloco"
                      />
                    </td>
                    <td>
                      <ng-container *ngTemplateOutlet="actions; context: { $implicit: row }" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="divide-y divide-app-border lg:hidden">
            @for (row of rows(); track rowId(row)) {
              <article class="space-y-2 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="break-words font-medium" [title]="row.invoiceId">
                      @if (kind() === 'invoices') {
                        <span class="font-normal text-app-text-secondary"
                          >{{ 'RESTAURANTS_DOCUMENTS.TECHNICAL_SHORT' | transloco }} ·
                        </span>
                      }
                      {{ reference(row) }}
                    </p>
                    <p class="text-sm text-app-text-secondary">
                      {{ date(issued(row)) }} · {{ row.tableDisplayName }}
                    </p>
                  </div>
                  <ng-container *ngTemplateOutlet="actions; context: { $implicit: row }" />
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold tabular-nums">{{
                    money(amount(row), row.currency)
                  }}</span
                  ><liass-status-chip size="sm" tone="neutral" [label]="status(row) | transloco" />
                </div>
                @if (kind() === 'credit-notes') {
                  <dl class="grid grid-cols-2 gap-2 text-sm">
                    <dt>{{ 'RESTAURANTS_CORRECTIONS.REFUNDED' | transloco }}</dt>
                    <dd class="text-right tabular-nums">
                      {{ money(credit(row).refundedMinor, row.currency) }}
                    </dd>
                    <dt>{{ 'RESTAURANTS_CORRECTIONS.REMAINING' | transloco }}</dt>
                    <dd class="text-right tabular-nums">
                      {{ money(credit(row).remainingRefundableMinor, row.currency) }}
                    </dd>
                  </dl>
                }
              </article>
            }
          </div>
          @if (!queryPending() && !rows().length && !queryError()) {
            <p class="text-sm text-app-text-secondary">
              {{ 'RESTAURANTS_DOCUMENTS.EMPTY' | transloco }}
            </p>
            <p class="text-xs text-app-text-secondary">
              {{ 'RESTAURANTS_DOCUMENTS.COVERAGE' | transloco }}
            </p>
          }
          @if (hasNext()) {
            <button mat-button [disabled]="fetching()" (click)="more()">
              {{ 'RESTAURANTS.CASH.MORE' | transloco }}
            </button>
          }
        </section>
      </mat-drawer-content></mat-drawer-container
    >
    <ng-template #actions let-row
      ><button
        mat-icon-button
        class="m-1.5 shrink-0"
        [matMenuTriggerFor]="menu"
        (menuOpened)="menuRow.set(row)"
        [attr.aria-label]="'RESTAURANTS.CASH.ACTIONS' | transloco"
      >
        <mat-icon>more_vert</mat-icon></button
      ><mat-menu #menu="matMenu" xPosition="before"
        ><button mat-menu-item (click)="open(row, kind() === 'invoices' ? 'invoice' : 'credit')">
          <mat-icon>visibility</mat-icon
          >{{
            (kind() === 'invoices'
              ? 'RESTAURANTS_DOCUMENTS.VIEW_INVOICE'
              : 'RESTAURANTS_DOCUMENTS.VIEW_CREDIT'
            ) | transloco
          }}
        </button>
        @if (kind() === 'invoices') {
          <button mat-menu-item (click)="bill(row)">
            <mat-icon>receipt_long</mat-icon>{{ 'RESTAURANTS.PAYMENT_ACTIONS.BILL' | transloco }}
          </button>
          <button mat-menu-item (click)="showCredits(row.invoiceId)">
            <mat-icon>history</mat-icon>{{ 'RESTAURANTS_DOCUMENTS.VIEW_CREDITS' | transloco }}
          </button>
          @if (canManage() && canCreate(row)) {
            <button mat-menu-item (click)="create(row)">
              <mat-icon>post_add</mat-icon>{{ 'RESTAURANTS_CORRECTIONS.CREATE' | transloco }}
            </button>
          }
        }
        @if (kind() === 'credit-notes') {
          <button mat-menu-item (click)="open(row, 'invoice')">
            <mat-icon>description</mat-icon>{{ 'RESTAURANTS_DOCUMENTS.VIEW_INVOICE' | transloco }}
          </button>
          @if (canManage() && credit(row).remainingRefundableMinor > 0) {
            @if (canRefund()) {
              <button mat-menu-item (click)="refund(row)">
                <mat-icon>payments</mat-icon>{{ 'RESTAURANTS_CORRECTIONS.REFUND' | transloco }}
              </button>
            } @else {
              <span class="block max-w-xs px-4 py-2 text-sm">{{
                'RESTAURANTS_CORRECTIONS.SESSION_REQUIRED' | transloco
              }}</span>
            }
          }
        }
      </mat-menu></ng-template
    >`,
})
export class RestaurantDocumentCollectionComponent {
  readonly kind = input.required<'invoices' | 'credit-notes'>();
  readonly active = input(true);
  readonly day = input<c.RestaurantBusinessDay | null>(null);
  readonly contextualInvoice = input<{ invoiceId: string; revision: number } | null>(null);
  readonly viewCredits = output<string>();
  readonly contextCleared = output<void>();
  readonly api = inject(RestaurantDocumentCollectionsQueries);
  readonly cash = inject(RestaurantCashQueries);
  readonly corrections = inject(RestaurantCorrectionsQueries);
  readonly invoiceApi = inject(RestaurantReceiptApi);
  readonly auth = inject(AuthStore);
  readonly t = inject(TranslocoService);
  readonly dialog = inject(MatDialog);
  readonly router = inject(Router);
  readonly menuRow = signal<Row | null>(null);
  readonly eligibility = injectInfiniteQuery(() => ({
    ...this.corrections.creditNotes(
      this.scope(),
      this.menuRow()?.guestSessionId ?? '00000000-0000-4000-8000-000000000000',
    ),
    enabled: !!this.menuRow() && this.kind() === 'invoices' && this.canManage(),
  }));
  readonly scope = computed(() => this.cash.context());
  readonly history = signal(false);
  readonly from = signal(new Date().toISOString().slice(0, 10));
  readonly to = signal(new Date().toISOString().slice(0, 10));
  readonly searchInput = signal('');
  readonly search = signal('');
  readonly selected = signal<Row | null>(null);
  readonly mode = signal<'invoice' | 'credit'>('invoice');
  readonly filters = computed(() => {
    const now = new Date();
    const timezone = this.day()?.operationalTimezone ?? 'UTC';
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    // Keep the operational window open to server-confirmed writes made later today.
    const end = this.history()
      ? documentDateBoundary(this.to(), timezone, true)
      : documentDateBoundary(today, timezone, true);
    const start = this.history()
      ? documentDateBoundary(this.from(), this.day()?.operationalTimezone ?? 'UTC')
      : new Date(
          Math.max(
            Date.parse(
              this.day()?.openedAt ?? new Date(now.getTime() - 7 * 86400000).toISOString(),
            ),
            Date.parse(end) - 31 * 86400000 + 1,
          ),
        ).toISOString();
    return {
      from: start,
      to: end,
      ...(!this.history() && this.day() ? { businessDayId: this.day()!.businessDayId } : {}),
      q: this.search(),
    };
  });
  readonly validRange = computed(
    () => c.RestaurantDocumentCollectionRequestSchema.safeParse(this.filters()).success,
  );
  readonly invoices = injectInfiniteQuery(() =>
    this.api.invoices(
      this.scope(),
      this.filters(),
      this.active() && this.kind() === 'invoices' && this.validRange(),
    ),
  );
  readonly credits = injectInfiniteQuery(() =>
    this.api.credits(
      this.scope(),
      this.filters(),
      this.active() && this.kind() === 'credit-notes' && this.validRange(),
    ),
  );
  readonly rows = computed<Row[]>(() =>
    this.kind() === 'invoices'
      ? (this.invoices.data()?.pages.flatMap((p) => p.items) ?? [])
      : (this.credits.data()?.pages.flatMap((p) => p.items) ?? []),
  );
  readonly currentSelection = computed(
    () =>
      this.rows().find(
        (row) => this.rowId(row) === (this.selected() ? this.rowId(this.selected()!) : ''),
      ) ?? this.selected(),
  );
  readonly current = injectQuery(() => ({
    ...this.cash.current(this.scope()),
    enabled: this.active(),
  }));
  readonly canManage = computed(() =>
    correctionRole(this.auth.activeWorkspace()?.productRoles?.RESTAURANTS),
  );
  readonly canRefund = computed(() =>
    refundContext(this.scope().user, this.current.data()?.data, this.day()),
  );
  readonly source = injectQuery(() => ({
    queryKey: ['restaurants', this.scope(), 'invoice-context', this.selected()?.guestSessionId],
    queryFn: () => this.invoiceApi.page(this.invoiceContext(this.selected()!)),
    enabled: !!this.selected() && this.mode() !== 'invoice',
  }));
  constructor() {
    effect(() => {
      const context = this.contextualInvoice();
      if (context && this.kind() === 'credit-notes') {
        this.selected.set(null);
        this.history.set(false);
        this.searchInput.set(context.invoiceId);
        this.search.set(context.invoiceId);
      }
    });
    effect((onCleanup) => {
      const value = this.searchInput().trim();
      const timer = setTimeout(() => this.search.set(value), 250);
      onCleanup(() => clearTimeout(timer));
    });
    effect(() => {
      this.scope();
      this.filters();
      this.selected.set(null);
      this.menuRow.set(null);
    });
  }
  invoiceContext(row: Row) {
    const s = this.scope();
    return {
      org: s.org,
      outlet: s.outlet,
      user: s.user,
      revision: s.revision,
      session: row.guestSessionId,
    };
  }
  credit(row: Row) {
    return row as CreditRow;
  }
  rowId(row: Row) {
    return 'creditNoteId' in row ? row.creditNoteId : row.invoiceId;
  }
  short(id: string) {
    return id.slice(0, 8) + '…';
  }
  reference(row: Row) {
    return 'creditNoteReference' in row ? row.creditNoteReference : this.short(row.invoiceId);
  }
  amount(row: Row) {
    return 'amountMinor' in row ? row.amountMinor : row.totalMinor;
  }
  issued(row: Row) {
    return 'issuedAt' in row ? row.issuedAt : row.validatedAt;
  }
  status(row: Row) {
    return 'remainingRefundableMinor' in row
      ? row.remainingRefundableMinor === 0
        ? 'RESTAURANTS_DOCUMENTS.REFUNDED'
        : row.refundedMinor > 0
          ? 'RESTAURANTS_DOCUMENTS.PARTIAL'
          : 'RESTAURANTS_CORRECTIONS.VALIDATED'
      : 'RESTAURANTS_DOCUMENTS.FINAL';
  }
  money(value: number, currency: string) {
    return restaurantPrice(value, currency, this.t.getActiveLang());
  }
  date(at: string) {
    return new Intl.DateTimeFormat(this.t.getActiveLang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: this.day()?.operationalTimezone,
    }).format(new Date(at));
  }
  showCredits(invoiceId: string) {
    this.selected.set(null);
    this.viewCredits.emit(invoiceId);
  }
  changeSearch(value: string) {
    this.searchInput.set(value);
    this.contextCleared.emit();
  }
  clearSearch() {
    this.searchInput.set('');
    this.search.set('');
    this.contextCleared.emit();
  }
  open(row: Row, mode: 'invoice' | 'credit') {
    this.mode.set(mode);
    this.selected.set(row);
  }
  canCreate(row: Row) {
    return (
      this.menuRow()?.invoiceId === row.invoiceId &&
      !!this.eligibility
        .data()
        ?.pages[0]?.creditability?.lines.some(
          (l) => l.remainingQuantity > 0 && l.remainingAmountMinor > 0,
        )
    );
  }
  create(row: Row) {
    const creditability = this.eligibility.data()?.pages[0]?.creditability;
    if (!this.canManage() || !this.canCreate(row) || !creditability) return;
    this.dialog.open(RestaurantCorrectionDialog, {
      width: '640px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: '90dvh',
      data: {
        scope: this.scope(),
        session: row.guestSessionId,
        currency: row.currency,
        creditability,
      },
    });
  }
  bill(row: Row) {
    return this.router.navigate([
      '/restaurants/service/outlets',
      this.scope().outlet,
      'sessions',
      row.guestSessionId,
    ]);
  }
  queryPending() {
    return this.kind() === 'invoices' ? this.invoices.isPending() : this.credits.isPending();
  }
  queryError() {
    return this.kind() === 'invoices' ? this.invoices.isError() : this.credits.isError();
  }
  hasNext() {
    return this.kind() === 'invoices' ? this.invoices.hasNextPage() : this.credits.hasNextPage();
  }
  fetching() {
    return this.kind() === 'invoices' ? this.invoices.isFetching() : this.credits.isFetching();
  }
  more() {
    return this.kind() === 'invoices'
      ? this.invoices.fetchNextPage()
      : this.credits.fetchNextPage();
  }
  retry() {
    return this.kind() === 'invoices' ? this.invoices.refetch() : this.credits.refetch();
  }
  async refund(row: Row) {
    if (!this.canManage() || !this.canRefund() || this.credit(row).remainingRefundableMinor <= 0)
      return;
    const detail = await this.cash.client.ensureQueryData(
      this.corrections.creditNote(this.scope(), this.credit(row).creditNoteId),
    );
    this.dialog.open(RestaurantCorrectionDialog, {
      width: '640px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: '90dvh',
      data: {
        scope: this.scope(),
        session: row.guestSessionId,
        currency: row.currency,
        credit: detail.data,
        refunded: this.credit(row).refundedMinor,
        remaining: this.credit(row).remainingRefundableMinor,
        openedAt: this.current.data()?.data?.openedAt,
      },
    });
  }
}
