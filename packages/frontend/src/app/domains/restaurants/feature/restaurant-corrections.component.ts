import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavModule } from '@angular/material/sidenav';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import {
  RestaurantReceiptSummary,
  RestaurantCreditNoteDetailResponseSchema,
  RestaurantCashSession,
  RestaurantBusinessDay,
} from '@liass-ohada/shared/restaurants';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { RestaurantCorrectionsQueries } from '../data-access/restaurant-corrections.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantCorrectionDialog } from './restaurant-correction.dialog';
import { restaurantPrice } from '../utils/restaurant-money';
export const correctionRole = (role: unknown) => role === 'OWNER' || role === 'MANAGER';
export function refundContext(
  user: string,
  session:
    | Pick<RestaurantCashSession, 'status' | 'cashierUserId' | 'businessDayId'>
    | null
    | undefined,
  day: Pick<RestaurantBusinessDay, 'status' | 'businessDayId'> | null | undefined,
) {
  return (
    !!session &&
    session.status === 'OPEN' &&
    session.cashierUserId === user &&
    !!day &&
    day.status === 'OPEN' &&
    session.businessDayId === day.businessDayId
  );
}

@Component({
  selector: 'liass-restaurant-corrections',
  host: { class: 'block min-w-0' },
  imports: [
    NgTemplateOutlet,
    TranslocoModule,
    MatSidenavModule,
    LiassButtonComponent,
    LiassStatusChipComponent,
  ],
  template: ` @if (detailOnly()) {
      <ng-container *ngTemplateOutlet="detailContent" />
    } @else {
      <mat-drawer-container
        [class]="selected() ? 'min-h-[75dvh] bg-transparent' : 'bg-transparent'"
        [hasBackdrop]="true"
      >
        <mat-drawer
          mode="over"
          position="end"
          class="min-w-0 border-l border-app-border bg-app-surface"
          [style.width]="'min(440px, 100%)'"
          [opened]="!!selected()"
          (closedStart)="closeDetail()"
          role="dialog"
          [attr.aria-label]="'RESTAURANTS_CORRECTIONS.DETAIL' | transloco"
        >
          <ng-container *ngTemplateOutlet="detailContent" />
        </mat-drawer>
        <mat-drawer-content>
          @if (!detailOnly()) {
            <section
              class="mt-5 space-y-3 rounded-app-card border border-app-border bg-app-surface p-4 sm:p-6"
            >
              <header class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="text-lg font-semibold">
                  {{ 'RESTAURANTS_CORRECTIONS.TITLE' | transloco }}
                </h2>
                <liass-button
                  size="icon"
                  variant="ghost"
                  icon="refresh"
                  [ariaLabel]="'RESTAURANTS_CORRECTIONS.REFRESH' | transloco"
                  [loading]="list.isFetching()"
                  (pressed)="list.refetch()"
                />
                @if (canCreate()) {
                  <liass-button icon="post_add" tone="brand" (pressed)="create()">{{
                    'RESTAURANTS_CORRECTIONS.CREATE' | transloco
                  }}</liass-button>
                }
              </header>
              @if (list.isPending()) {
                <p role="status">{{ 'RESTAURANTS_CORRECTIONS.LOADING' | transloco }}</p>
              }
              @if (list.isError()) {
                <p role="alert">{{ 'RESTAURANTS_CORRECTIONS.RETRY' | transloco }}</p>
                <liass-button (pressed)="list.refetch()">{{
                  'RESTAURANTS_CORRECTIONS.REFRESH' | transloco
                }}</liass-button>
              }
              @for (credit of rows(); track credit.creditNoteId) {
                <div
                  class="flex min-w-0 items-start justify-between gap-3 border-b border-app-border py-3"
                >
                  <div class="min-w-0 space-y-1">
                    <p class="break-words font-medium">{{ credit.creditNoteReference }}</p>
                    <p class="text-sm tabular-nums">
                      {{ money(credit.amountMinor) }} · {{ date(credit.validatedAt) }}
                    </p>
                    <p class="break-words text-sm text-app-text-secondary">{{ credit.reason }}</p>
                  </div>
                  <liass-button
                    size="icon"
                    variant="ghost"
                    icon="visibility"
                    [ariaLabel]="'RESTAURANTS_CORRECTIONS.DETAIL' | transloco"
                    (pressed)="selected.set(credit.creditNoteId)"
                  />
                </div>
              }
              @if (!list.isPending() && !list.isError() && !rows().length) {
                <p class="text-sm text-app-text-secondary">
                  {{ 'RESTAURANTS_CORRECTIONS.EMPTY' | transloco }}
                </p>
              }
              @if (list.hasNextPage()) {
                <liass-button
                  [loading]="list.isFetchingNextPage()"
                  (pressed)="list.fetchNextPage()"
                  >{{ 'RESTAURANTS_CORRECTIONS.MORE' | transloco }}</liass-button
                >
              }
            </section>
          }
        </mat-drawer-content>
      </mat-drawer-container>
    }
    <ng-template #detailContent>
      <div class="space-y-4 p-5">
        <header class="flex items-start justify-between gap-3">
          <h2 class="break-words text-xl font-semibold">
            {{ 'RESTAURANTS_CORRECTIONS.DETAIL' | transloco }}
          </h2>
          <liass-button
            size="icon"
            variant="ghost"
            icon="close"
            [ariaLabel]="'COMMON.ACTIONS.CLOSE' | transloco"
            (pressed)="closeDetail()"
          />
        </header>
        @if (detail.isPending()) {
          <p role="status">{{ 'RESTAURANTS_CORRECTIONS.LOADING' | transloco }}</p>
        }
        @if (detail.isError()) {
          <p role="alert">{{ 'RESTAURANTS_CORRECTIONS.RETRY' | transloco }}</p>
          <liass-button (pressed)="detail.refetch()">{{
            'RESTAURANTS_CORRECTIONS.REFRESH' | transloco
          }}</liass-button>
        }
        @if (detail.data(); as credit) {
          <p class="break-words font-semibold">{{ credit.data.creditNoteReference }}</p>
          <p class="text-2xl font-semibold tabular-nums">{{ money(credit.data.amountMinor) }}</p>
          <liass-status-chip
            tone="neutral"
            [label]="'RESTAURANTS_CORRECTIONS.VALIDATED' | transloco"
          />
          <p class="text-sm text-app-text-secondary">
            {{ date(credit.data.validatedAt) }} · {{ summary().tableName }}
          </p>
          @if (actorLabel(credit.data.validatedByUserId)) {
            <p class="text-sm text-app-text-secondary">
              {{ actorLabel(credit.data.validatedByUserId) }}
            </p>
          }
          <div>
            <h3 class="text-sm text-app-text-secondary">
              {{ 'RESTAURANTS_CORRECTIONS.REASON' | transloco }}
            </h3>
            <p class="whitespace-pre-wrap break-words">{{ credit.data.reason }}</p>
          </div>
          <h3 class="font-semibold">{{ 'RESTAURANTS_CORRECTIONS.LINES' | transloco }}</h3>
          @for (line of credit.lines; track line.creditNoteLineId) {
            <div class="flex justify-between gap-3 border-b border-app-border py-2 text-sm">
              <span class="break-words">{{ line.creditedQuantity }} × {{ line.label }}</span
              ><span class="shrink-0 tabular-nums">{{ money(line.creditedAmountMinor) }}</span>
            </div>
          }
          <h3 class="font-semibold">{{ 'RESTAURANTS_CORRECTIONS.REFUNDS' | transloco }}</h3>
          @if (refunds.isPending()) {
            <p role="status">{{ 'RESTAURANTS_CORRECTIONS.LOADING' | transloco }}</p>
          }
          @if (refunds.isError()) {
            <p role="alert">{{ 'RESTAURANTS_CORRECTIONS.RETRY' | transloco }}</p>
            <liass-button (pressed)="refunds.refetch()">{{
              'RESTAURANTS_CORRECTIONS.REFRESH' | transloco
            }}</liass-button>
          }
          @if (refundComplete()) {
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between gap-3">
                <dt>{{ 'RESTAURANTS_CORRECTIONS.REFUNDED' | transloco }}</dt>
                <dd class="tabular-nums">{{ money(refunded()) }}</dd>
              </div>
              <div class="flex justify-between gap-3 font-semibold">
                <dt>{{ 'RESTAURANTS_CORRECTIONS.REMAINING' | transloco }}</dt>
                <dd class="tabular-nums">{{ money(remaining()) }}</dd>
              </div>
            </dl>
            @if (canManage() && remaining() > 0) {
              @if (canRefund()) {
                <liass-button icon="payments" tone="brand" (pressed)="refund()">{{
                  'RESTAURANTS_CORRECTIONS.REFUND' | transloco
                }}</liass-button>
              } @else {
                <p class="text-sm text-app-text-secondary">
                  {{ 'RESTAURANTS_CORRECTIONS.SESSION_REQUIRED' | transloco }}
                </p>
              }
            }
          }
          @for (refund of refundRows(); track refund.refundId) {
            <section class="space-y-1 border-b border-app-border py-3 text-sm">
              <p class="break-words font-medium">{{ refund.refundReference }}</p>
              <p>
                {{ money(refund.amountMinor) }} ·
                {{ 'RESTAURANTS.CHECKOUT.' + refund.method | transloco }}
              </p>
              <p class="text-app-text-secondary">{{ date(refund.refundedAt) }}</p>
              @if (actorLabel(refund.refundedByUserId)) {
                <p class="text-app-text-secondary">{{ actorLabel(refund.refundedByUserId) }}</p>
              }
              @if (refund.externalReference) {
                <p class="break-words">{{ refund.externalReference }}</p>
              }
            </section>
          }
          @if (refunds.hasNextPage()) {
            <liass-button
              [loading]="refunds.isFetchingNextPage()"
              (pressed)="refunds.fetchNextPage()"
              >{{ 'RESTAURANTS_CORRECTIONS.MORE' | transloco }}</liass-button
            >
          }
        }
      </div>
    </ng-template>`,
})
export class RestaurantCorrectionsComponent {
  readonly summary = input.required<RestaurantReceiptSummary>();
  readonly initialCreditId = input('');
  readonly detailOnly = input(false);
  readonly refundSummary = input<{
    refundedMinor: number;
    remainingRefundableMinor: number;
  } | null>(null);
  readonly detailClosed = output<void>();
  closeDetail() {
    this.selected.set('');
    if (this.detailOnly()) this.detailClosed.emit();
  }
  private readonly api = inject(RestaurantCorrectionsQueries);
  private readonly cash = inject(RestaurantCashQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly dialog = inject(MatDialog);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  actorLabel(id: string) {
    return id === this.auth.currentUserId() ? this.auth.currentUserDisplayName() : null;
  }
  readonly selected = signal('');
  readonly scope = computed(() => this.cash.context());
  readonly canManage = computed(
    () =>
      this.caps.canManageSetup() &&
      correctionRole(this.auth.activeWorkspace()?.productRoles?.RESTAURANTS),
  );
  readonly list = injectInfiniteQuery(() => ({
    ...this.api.creditNotes(this.scope(), this.summary().guestSessionId),
    enabled: !this.detailOnly(),
  }));
  readonly rows = computed(() => this.list.data()?.pages.flatMap((p) => p.items) ?? []);
  readonly creditability = computed(() => this.list.data()?.pages[0]?.creditability);
  readonly canCreate = computed(
    () =>
      this.canManage() && !!this.creditability()?.lines.some((line) => line.remainingQuantity > 0),
  );
  readonly detail = injectQuery(() => ({
    ...this.cash.options(
      this.scope(),
      `credit-notes/${this.selected()}`,
      RestaurantCreditNoteDetailResponseSchema,
      !!this.selected(),
    ),
    enabled: !!this.selected(),
  }));
  readonly refunds = injectInfiniteQuery(() => ({
    ...this.api.refunds(this.scope(), this.selected() || '00000000-0000-4000-8000-000000000000'),
    enabled: !!this.selected(),
  }));
  readonly refundRows = computed(() => this.refunds.data()?.pages.flatMap((p) => p.items) ?? []);
  readonly refundComplete = computed(
    () => !!this.refunds.data() && !this.refunds.hasNextPage() && !this.refunds.isError(),
  );
  readonly refunded = computed(
    () =>
      this.refundSummary()?.refundedMinor ??
      this.refundRows().reduce((n, r) => n + r.amountMinor, 0),
  );
  readonly remaining = computed(
    () =>
      this.refundSummary()?.remainingRefundableMinor ??
      (this.detail.data()?.data.amountMinor ?? 0) - this.refunded(),
  );
  readonly current = injectQuery(() => ({
    ...this.cash.current(this.scope()),
    enabled: this.canManage() && !!this.selected(),
  }));
  readonly day = injectQuery(() => ({
    ...this.cash.day(this.scope()),
    enabled: this.canManage() && !!this.selected(),
  }));
  readonly canRefund = computed(() => {
    const s = this.current.data()?.data;
    const d = this.day.data()?.data;
    return refundContext(this.scope().user, s, d);
  });
  constructor() {
    effect(() => {
      this.summary().guestSessionId;
      this.scope();
      this.selected.set(this.initialCreditId());
    });
  }
  money(value: number) {
    return restaurantPrice(value, this.summary().currency, this.t.getActiveLang());
  }
  date(value: string) {
    return new Intl.DateTimeFormat(this.t.getActiveLang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }
  create() {
    const creditability = this.creditability();
    if (!this.canCreate() || !creditability) return;
    this.open({
      scope: this.scope(),
      session: this.summary().guestSessionId,
      currency: this.summary().currency,
      creditability,
    });
  }
  refund() {
    const credit = this.detail.data()?.data;
    if (
      !credit ||
      !this.canManage() ||
      !this.canRefund() ||
      !this.refundComplete() ||
      this.remaining() <= 0
    )
      return;
    this.open({
      scope: this.scope(),
      session: this.summary().guestSessionId,
      currency: credit.currency,
      credit,
      remaining: this.remaining(),
      refunded: this.refunded(),
      openedAt: this.current.data()?.data?.openedAt,
    });
  }
  private open(data: import('./restaurant-correction.dialog').CorrectionDialogData) {
    this.dialog
      .open(RestaurantCorrectionDialog, {
        data,
        width: '640px',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: '90dvh',
      })
      .afterClosed()
      .subscribe((result) => {
        if (result?.data) {
          this.notification.success(result.data.creditNoteReference ?? result.data.refundReference);
          if (result.data.creditNoteId) this.selected.set(result.data.creditNoteId);
        }
      });
  }
}
