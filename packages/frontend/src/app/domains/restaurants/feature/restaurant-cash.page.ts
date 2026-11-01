import { MatTabsModule } from '@angular/material/tabs';
import { LiassTablePreferencesDialogComponent } from '../../../shared/ui/table-preferences/table-preferences-dialog.component';
import {
  loadTablePreferences,
  saveTablePreferences,
} from '../../../shared/ui/table-preferences/table-preferences.storage';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSidenavModule } from '@angular/material/sidenav';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { formatExactMoney } from '../../../shared/utils/exact-money-display';
@Component({
  selector: 'liass-cash-command',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TranslocoModule,
  ],
  template: ` <h2 mat-dialog-title>
      {{ 'RESTAURANTS.CASH.' + data.label | transloco: { name: data.name } }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="space-y-4">
        <p>{{ data.context }} · {{ data.currency }}</p>
        @if (data.session; as session) {
          <dl
            class="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-app-border py-4 text-sm [&_dd]:text-right [&_dd]:font-semibold [&_dd]:tabular-nums"
          >
            @for (item of drawer(session); track item.key) {
              <dt>{{ 'RESTAURANTS.CASH.' + item.key | transloco }}</dt>
              <dd>{{ formatNumber(item.amount) }} {{ session.currency }}</dd>
            }
          </dl>
        }
        @if (data.amount) {
          <mat-form-field class="w-full"
            ><mat-label>{{ 'RESTAURANTS.CASH.' + data.amount | transloco }}</mat-label
            ><input matInput inputmode="numeric" type="number" min="0" formControlName="amount"
          /></mat-form-field>
        }
        @if (data.session) {
          <p role="status">
            {{ 'RESTAURANTS.CASH.PREVIEW' | transloco }} : {{ preview() }} {{ data.currency }}
          </p>
        }
        @if (data.reason) {
          <mat-form-field class="w-full"
            ><mat-label>{{ 'RESTAURANTS.CASH.REASON' | transloco }}</mat-label
            ><textarea matInput formControlName="reason" maxlength="500"></textarea>
          </mat-form-field>
        }
        @if (error()) {
          <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
        }
        @if (busy()) {
          <p role="status">{{ 'RESTAURANTS.CASH.PROCESSING' | transloco }}</p>
        }</mat-dialog-content
      ><mat-dialog-actions align="end"
        ><button mat-button type="button" [disabled]="busy()" (click)="ref.close()">
          {{ 'COMMON.ACTIONS.CANCEL' | transloco }}</button
        ><button mat-flat-button [disabled]="busy() || form.invalid">
          {{ 'RESTAURANTS.CASH.' + data.label | transloco: { name: data.name } }}
        </button></mat-dialog-actions
      >
    </form>`,
})
export class RestaurantCashCommandDialog {
  formatNumber(value: number | undefined) {
    if (value === undefined) return '—';
    return new Intl.NumberFormat(this.data.locale ?? 'fr', {
      maximumFractionDigits: 0,
      useGrouping: true,
    }).format(value);
  }

  readonly data = inject<{
    label: string;
    locale?: string;
    name?: string;
    context: string;
    currency: string;
    amount?: string;
    reason?: boolean;
    session?: c.RestaurantCashSession;
    execute: (amount: number, reason: string) => Promise<void>;
  }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<RestaurantCashCommandDialog>);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    amount: [
      null as number | null,
      [
        Validators.required,
        Validators.min(0),
        Validators.max(Number.MAX_SAFE_INTEGER),
        Validators.pattern(/^\d+$/),
      ],
    ],
    reason: ['', this.data.reason ? [Validators.required, Validators.pattern(/\S/)] : []],
  });
  constructor() {
    if (!this.data.amount) this.form.controls.amount.clearValidators();
    if (this.data.reason) this.form.controls.amount.addValidators(Validators.min(1));
    this.form.controls.amount.updateValueAndValidity();
  }
  drawer(s: c.RestaurantCashSession) {
    return [
      { key: 'FLOAT', amount: s.openingCashAmountMinor },
      { key: 'CASH', amount: s.paidByMethodMinor.CASH },
      { key: 'CASH_IN', amount: s.cashInMinor },
      { key: 'CASH_OUT', amount: s.cashOutMinor },
      { key: 'EXPECTED', amount: s.expectedCashAmountMinor },
    ];
  }
  preview() {
    const n = this.form.controls.amount.value;
    if (n === null || !this.data.session) return '—';
    const v = n - this.data.session.expectedCashAmountMinor;
    return (v > 0 ? '+' : '') + v.toLocaleString(this.data.locale ?? 'fr');
  }
  async submit() {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(false);
    try {
      const v = this.form.getRawValue();
      await this.data.execute(v.amount ?? 0, v.reason);
      this.ref.close(true);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
      this.ref.disableClose = false;
    }
  }
}
@Component({
  selector: 'liass-restaurant-cash',
  imports: [
    MatTabsModule,
    MatMenuModule,
    MatIconModule,
    MatTooltipModule,
    MatSidenavModule,
    LiassButtonComponent,
    LiassStatusChipComponent,
    LiassPageHeaderComponent,
    LiassCardComponent,
    TranslocoModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  template: ` <mat-drawer-container
    class="min-h-[calc(100vh-9rem)] bg-transparent"
    [hasBackdrop]="true"
  >
    <mat-drawer-content
      ><div class="space-y-5">
        <liass-page-header
          [eyebrow]="'RESTAURANTS.PAGE.TITLE' | transloco"
          [title]="'RESTAURANTS.CASH.' + (management ? 'DAY_REVIEW' : 'MY_CASH') | transloco"
          [subtitle]="cash.outlet.outlet()?.name ?? ''"
        />
        <liass-card
          ><div class="space-y-4">
            @if (day.isPending()) {
              <p role="status">{{ 'RESTAURANTS.CASH.LOADING' | transloco }}</p>
            } @else if (day.isError()) {
              <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
              <button mat-button (click)="day.refetch()">
                {{ 'RESTAURANTS.CASH.RETRY' | transloco }}
              </button>
            } @else if (!day.data()?.data && !closedDay()) {
              <p>{{ 'RESTAURANTS.CASH.NO_DAY' | transloco }}</p>
              @if (caps.canManageSetup()) {
                <button mat-flat-button (click)="openDay()">
                  {{ 'RESTAURANTS.CASH.OPEN_DAY' | transloco }}
                </button>
              } @else {
                <p>{{ 'RESTAURANTS.CASH.CONTACT_MANAGER' | transloco }}</p>
              }
            } @else {
              @if (management) {
                @if (activeDay(); as d) {
                  <div
                    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-app-muted"
                    data-day-context
                  >
                    <span class="font-medium text-app-text"
                      >{{ 'RESTAURANTS.CASH.DAY' | transloco }}
                      {{ businessDate(d.businessDate) }}</span
                    >
                    <liass-status-chip
                      [label]="'RESTAURANTS.CASH.' + d.status | transloco"
                      [tone]="d.status === 'OPEN' ? 'success' : 'neutral'"
                      size="sm"
                    />
                    <span>{{ timestamp(d.openedAt) }} · {{ d.operationalTimezone }}</span>
                  </div>
                }
              }
              @if (management && caps.canManageSetup()) {
                @if (summary.data()?.data; as totals) {
                  <div
                    class="rounded-app-card bg-brand-50 p-3.5 md:p-4 dark:bg-brand-950/35"
                    data-day-summary
                  >
                    <div class="flex items-center gap-3 text-brand-700 dark:text-brand-300">
                      <mat-icon aria-hidden="true">payments</mat-icon>
                      <div>
                        <p class="text-xs font-medium">
                          {{ 'RESTAURANTS.CASH.COLLECTIONS' | transloco }}
                        </p>
                        <p class="text-2xl font-semibold tabular-nums">
                          {{ formatNumber(totals.totalPaymentsMinor) }} {{ activeDay()?.currency }}
                        </p>
                      </div>
                    </div>
                    <dl
                      class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-brand-100 pt-2 text-sm sm:grid-cols-3 xl:grid-cols-6 dark:border-brand-900"
                      data-day-summary-details
                    >
                      <div>
                        <dt class="text-app-muted">{{ 'RESTAURANTS.CASH.CASH' | transloco }}</dt>
                        <dd class="font-semibold tabular-nums">
                          {{ formatNumber(totals.paidByMethodMinor.CASH) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-app-muted">
                          {{ 'RESTAURANTS.CASH.MOBILE_MONEY' | transloco }}
                        </dt>
                        <dd class="font-semibold tabular-nums">
                          {{ formatNumber(totals.paidByMethodMinor.MOBILE_MONEY) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-app-muted">{{ 'RESTAURANTS.CASH.CARD' | transloco }}</dt>
                        <dd class="font-semibold tabular-nums">
                          {{ formatNumber(totals.paidByMethodMinor.CARD) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-app-muted">
                          {{ 'RESTAURANTS.CASH.OPEN_SESSIONS' | transloco }}
                        </dt>
                        <dd class="font-semibold tabular-nums text-success-600">
                          {{ totals.openSessionCount }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-app-muted">
                          {{ 'RESTAURANTS.CASH.CLOSED_SESSIONS' | transloco }}
                        </dt>
                        <dd class="font-semibold tabular-nums">{{ totals.closedSessionCount }}</dd>
                      </div>
                      <div>
                        <dt class="text-app-muted">
                          {{ 'RESTAURANTS.CASH.CLOSED_VARIANCE' | transloco }}
                        </dt>
                        <dd
                          class="font-semibold tabular-nums"
                          [class.text-warning-600]="totals.closedVarianceMinor < 0"
                        >
                          {{ signed(totals.closedVarianceMinor) }} {{ activeDay()?.currency }}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div class="flex flex-wrap items-center justify-between gap-3" data-cash-toolbar>
                    <div class="w-full sm:w-auto" data-search-controls>
                      <mat-form-field subscriptSizing="dynamic" class="w-full sm:w-80 lg:w-96"
                        ><mat-label>{{ 'RESTAURANTS.CASH.SEARCH' | transloco }}</mat-label
                        ><input matInput [formControl]="search"
                      /></mat-form-field>
                    </div>
                    <div class="flex items-center gap-3" data-management-actions>
                      <liass-button
                        size="icon"
                        variant="ghost"
                        icon="view_column"
                        [ariaLabel]="'RESTAURANTS.CASH.COLUMNS' | transloco"
                        [matTooltip]="'RESTAURANTS.CASH.COLUMNS' | transloco"
                        (pressed)="preferences()"
                      />
                      <liass-button
                        tone="brand"
                        variant="solid"
                        icon="lock"
                        [disabled]="totals.openSessionCount > 0 || activeDay()?.status !== 'OPEN'"
                        (pressed)="closeDay()"
                      >
                        {{ 'RESTAURANTS.CASH.CLOSE_DAY' | transloco }}
                      </liass-button>
                    </div>
                  </div>
                  <div class="divide-y divide-app-border lg:hidden">
                    @for (row of filtered(totals.sessions); track row.session.cashSessionId) {
                      <div class="py-3 space-y-2">
                        <strong>{{ identity(row.session) }}</strong>
                        <p>
                          <liass-status-chip
                            [label]="'RESTAURANTS.CASH.' + row.session.status | transloco"
                            [tone]="row.session.status === 'OPEN' ? 'success' : 'neutral'"
                            size="sm"
                          />
                          · {{ timestamp(row.session.openedAt) }}
                        </p>
                        <p>
                          {{ 'RESTAURANTS.CASH.EXPECTED' | transloco }} :
                          {{ formatNumber(row.session.expectedCashAmountMinor) }}
                          {{ row.session.currency }}
                        </p>
                        <p>
                          {{ 'RESTAURANTS.CASH.VARIANCE' | transloco }} :
                          {{
                            row.session.status === 'CLOSED'
                              ? signed(row.session.varianceAmountMinor)
                              : '—'
                          }}
                          @if (row.session.status === 'CLOSED') {
                            {{ row.session.currency }}
                          }
                        </p>
                        <button
                          mat-icon-button
                          [matMenuTriggerFor]="sessionActions"
                          [attr.aria-label]="'RESTAURANTS.CASH.ACTIONS' | transloco"
                          data-session-overflow
                        >
                          <mat-icon>more_vert</mat-icon>
                        </button>
                        <mat-menu #sessionActions="matMenu" xPosition="before">
                          <button mat-menu-item (click)="inspect(row.session.cashSessionId)">
                            <mat-icon>visibility</mat-icon
                            ><span>{{ 'RESTAURANTS.CASH.DETAIL' | transloco }}</span>
                          </button>
                          @if (row.session.status === 'OPEN' && caps.canManageSetup()) {
                            <button mat-menu-item (click)="move(row.session, 'CASH_IN')">
                              <mat-icon>arrow_downward</mat-icon
                              ><span>{{ 'RESTAURANTS.CASH.CASH_IN' | transloco }}</span>
                            </button>
                            <button mat-menu-item (click)="move(row.session, 'CASH_OUT')">
                              <mat-icon>arrow_upward</mat-icon
                              ><span>{{ 'RESTAURANTS.CASH.CASH_OUT' | transloco }}</span>
                            </button>
                          }
                          @if (row.session.status === 'OPEN') {
                            <button
                              mat-menu-item
                              class="liass-menu-action liass-menu-action-warning"
                              (click)="close(row.session)"
                            >
                              <mat-icon>lock</mat-icon
                              ><span>{{
                                'RESTAURANTS.CASH.' + closeLabel(row.session)
                                  | transloco: { name: row.session.cashierDisplayName }
                              }}</span>
                            </button>
                          }
                        </mat-menu>
                      </div>
                    }
                  </div>
                  <div
                    class="hidden overflow-x-auto rounded-app-card border border-app-border lg:block"
                  >
                    <table
                      class="liass-data-table w-full min-w-[640px] border-collapse text-left text-sm"
                    >
                      <thead>
                        <tr class="bg-app-table-header text-app-table-header-text">
                          <th scope="col" class="px-3 py-3">
                            {{ 'RESTAURANTS.CASH.CASHIER' | transloco }}
                          </th>
                          @if (visibleColumns().includes('OPENED_AT')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.OPENED_AT' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('COUNTED')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.COUNTED' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('STATUS')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.STATUS' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('CASH')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.CASH' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('MOBILE_MONEY')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.MOBILE_MONEY' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('CARD')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.CARD' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('EXPECTED')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.EXPECTED' | transloco }}
                            </th>
                          }
                          @if (visibleColumns().includes('VARIANCE')) {
                            <th scope="col" class="px-3 py-3">
                              {{ 'RESTAURANTS.CASH.VARIANCE' | transloco }}
                            </th>
                          }
                          <th scope="col" class="px-3 py-3">
                            {{ 'RESTAURANTS.CASH.ACTIONS' | transloco }}
                          </th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-app-border">
                        @for (row of filtered(totals.sessions); track row.session.cashSessionId) {
                          <tr class="bg-app-table-row hover:bg-app-table-row-hover">
                            <td class="px-3 py-3">
                              {{ identity(row.session) }}
                            </td>
                            @if (visibleColumns().includes('OPENED_AT')) {
                              <td class="px-3 py-3">{{ timestamp(row.session.openedAt) }}</td>
                            }
                            @if (visibleColumns().includes('COUNTED')) {
                              <td class="px-3 py-3 text-right tabular-nums">
                                {{
                                  row.session.status !== 'CLOSED' ||
                                  row.session.countedCashAmountMinor === undefined
                                    ? '—'
                                    : formatNumber(row.session.countedCashAmountMinor)
                                }}
                              </td>
                            }
                            @if (visibleColumns().includes('STATUS')) {
                              <td class="px-3 py-3">
                                <liass-status-chip
                                  [label]="'RESTAURANTS.CASH.' + row.session.status | transloco"
                                  [tone]="row.session.status === 'OPEN' ? 'success' : 'neutral'"
                                  size="sm"
                                />
                              </td>
                            }
                            @if (visibleColumns().includes('CASH')) {
                              <td class="px-3 py-3 text-right tabular-nums">
                                {{ formatNumber(row.session.paidByMethodMinor.CASH) }}
                              </td>
                            }
                            @if (visibleColumns().includes('MOBILE_MONEY')) {
                              <td class="px-3 py-3 text-right tabular-nums">
                                {{ formatNumber(row.session.paidByMethodMinor.MOBILE_MONEY) }}
                              </td>
                            }
                            @if (visibleColumns().includes('CARD')) {
                              <td class="px-3 py-3 text-right tabular-nums">
                                {{ formatNumber(row.session.paidByMethodMinor.CARD) }}
                              </td>
                            }
                            @if (visibleColumns().includes('EXPECTED')) {
                              <td class="px-3 py-3 text-right tabular-nums">
                                {{ formatNumber(row.session.expectedCashAmountMinor) }}
                              </td>
                            }
                            @if (visibleColumns().includes('VARIANCE')) {
                              <td class="px-3 py-3 text-right tabular-nums">
                                {{
                                  row.session.status === 'CLOSED'
                                    ? signed(row.session.varianceAmountMinor)
                                    : '—'
                                }}
                              </td>
                            }
                            <td class="px-3 py-3">
                              <button
                                mat-icon-button
                                [matMenuTriggerFor]="sessionActions"
                                [attr.aria-label]="'RESTAURANTS.CASH.ACTIONS' | transloco"
                                data-session-overflow
                              >
                                <mat-icon>more_vert</mat-icon>
                              </button>
                              <mat-menu #sessionActions="matMenu" xPosition="before">
                                <button mat-menu-item (click)="inspect(row.session.cashSessionId)">
                                  <mat-icon>visibility</mat-icon
                                  ><span>{{ 'RESTAURANTS.CASH.DETAIL' | transloco }}</span>
                                </button>
                                @if (row.session.status === 'OPEN' && caps.canManageSetup()) {
                                  <button mat-menu-item (click)="move(row.session, 'CASH_IN')">
                                    <mat-icon>arrow_downward</mat-icon
                                    ><span>{{ 'RESTAURANTS.CASH.CASH_IN' | transloco }}</span>
                                  </button>
                                  <button mat-menu-item (click)="move(row.session, 'CASH_OUT')">
                                    <mat-icon>arrow_upward</mat-icon
                                    ><span>{{ 'RESTAURANTS.CASH.CASH_OUT' | transloco }}</span>
                                  </button>
                                }
                                @if (row.session.status === 'OPEN') {
                                  <button
                                    mat-menu-item
                                    class="liass-menu-action liass-menu-action-warning"
                                    (click)="close(row.session)"
                                  >
                                    <mat-icon>lock</mat-icon
                                    ><span>{{
                                      'RESTAURANTS.CASH.' + closeLabel(row.session)
                                        | transloco: { name: row.session.cashierDisplayName }
                                    }}</span>
                                  </button>
                                }
                              </mat-menu>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p role="status">{{ 'RESTAURANTS.CASH.LOADING' | transloco }}</p>
                }
              }
              @if (!management) {
                @if (session(); as s) {
                  <section
                    class="space-y-4 border-t border-app-border pt-4"
                    [attr.aria-label]="identity(s)"
                    data-session-detail
                  >
                    <div
                      class="flex flex-wrap items-center justify-between gap-3"
                      data-personal-session-header
                    >
                      <div
                        class="flex flex-wrap items-center gap-x-3 gap-y-2"
                        data-personal-session-status
                      >
                        <h2 class="text-lg font-semibold">{{ identity(s) }}</h2>
                        <liass-status-chip
                          [label]="'RESTAURANTS.CASH.' + s.status | transloco"
                          [tone]="s.status === 'OPEN' ? 'success' : 'neutral'"
                          size="sm"
                        />
                        <span class="text-sm text-app-muted">{{ timestamp(s.openedAt) }}</span>
                      </div>
                      @if (s.status === 'OPEN') {
                        <div data-session-header-actions>
                          <liass-button
                            tone="brand"
                            variant="solid"
                            icon="lock"
                            (pressed)="close(s)"
                            >{{
                              'RESTAURANTS.CASH.' + closeLabel(s)
                                | transloco: { name: s.cashierDisplayName }
                            }}</liass-button
                          >
                        </div>
                      }
                    </div>
                    @if (s.status === 'OPEN' && caps.canManageSetup()) {
                      <div class="flex flex-wrap items-center gap-3" data-session-actions>
                        <liass-button
                          tone="success"
                          variant="outline"
                          icon="arrow_downward"
                          (pressed)="move(s, 'CASH_IN')"
                          >{{ 'RESTAURANTS.CASH.CASH_IN' | transloco }}</liass-button
                        >
                        <liass-button
                          tone="warning"
                          variant="outline"
                          icon="arrow_upward"
                          (pressed)="move(s, 'CASH_OUT')"
                          >{{ 'RESTAURANTS.CASH.CASH_OUT' | transloco }}</liass-button
                        >
                      </div>
                    }
                    <mat-tab-group
                      [mat-stretch-tabs]="false"
                      [disablePagination]="true"
                      mat-align-tabs="start"
                      [selectedIndex]="activityTab()"
                      (selectedIndexChange)="activityTab.set($event)"
                      ><mat-tab labelClass="!min-w-0 !px-2 sm:!px-6"
                        ><ng-template mat-tab-label
                          ><span class="inline-flex items-center gap-2 whitespace-nowrap"
                            ><mat-icon class="hidden sm:inline-flex" aria-hidden="true"
                              >payments</mat-icon
                            ><span
                              >{{ 'RESTAURANTS.CASH.COLLECTIONS' | transloco }} ·
                              {{ formatNumber(s.paymentCount) }}</span
                            ></span
                          ></ng-template
                        >
                        <ng-template matTabContent>
                          <section class="space-y-3 pt-3" data-activity-payments>
                            @if (payments.isPending()) {
                              <p role="status">{{ 'RESTAURANTS.CASH.LOADING' | transloco }}</p>
                            } @else if (payments.isError()) {
                              <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
                            } @else {
                              <div class="hidden overflow-x-auto lg:block">
                                <table class="liass-data-table w-full text-left text-sm">
                                  <thead>
                                    <tr>
                                      <th scope="col" class="w-px px-3 text-left whitespace-nowrap">
                                        {{ 'RESTAURANTS.CASH.DATE_TIME' | transloco }}
                                      </th>
                                      <th scope="col" class="w-px px-3 text-left whitespace-nowrap">
                                        {{ 'RESTAURANTS.CASH.PAYMENT_REFERENCE' | transloco }}
                                      </th>
                                      <th scope="col" class="px-3 text-left">
                                        {{ 'RESTAURANTS.CASH.TABLE_CONTEXT' | transloco }}
                                      </th>
                                      <th scope="col" class="w-px px-3 text-left whitespace-nowrap">
                                        {{ 'RESTAURANTS.CASH.METHOD' | transloco }}
                                      </th>
                                      <th
                                        scope="col"
                                        class="w-px px-3 text-right whitespace-nowrap"
                                      >
                                        {{ 'RESTAURANTS.CASH.AMOUNT' | transloco }}
                                      </th>
                                      <th scope="col" class="w-px px-3 text-left whitespace-nowrap">
                                        {{ 'RESTAURANTS.CASH.STATUS' | transloco }}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    @for (row of payments.data()?.items; track $index) {
                                      <tr>
                                        <td class="px-3 whitespace-nowrap">
                                          {{ timestamp(row.capturedAt) }}
                                        </td>
                                        <td class="px-3 text-left">
                                          {{ row.paymentReference ?? '—' }}
                                        </td>
                                        <td class="px-3 text-left">
                                          {{ row.tableDisplayName ?? '—' }}
                                        </td>
                                        <td class="px-3 whitespace-nowrap">
                                          <span class="inline-flex items-center gap-2"
                                            ><mat-icon aria-hidden="true">{{
                                              paymentIcon(row.method)
                                            }}</mat-icon
                                            >{{
                                              'RESTAURANTS.CASH.' + row.method | transloco
                                            }}</span
                                          >
                                        </td>
                                        <td class="px-3 text-right tabular-nums whitespace-nowrap">
                                          {{ formatCashAmount(row.amountMinor, row.currency) }}
                                        </td>
                                        <td class="px-3">
                                          <liass-status-chip
                                            [label]="'RESTAURANTS.CASH.CAPTURED' | transloco"
                                            tone="success"
                                            size="sm"
                                          />
                                        </td>
                                      </tr>
                                    }
                                  </tbody>
                                </table>
                              </div>
                              <div class="divide-y divide-app-border lg:hidden">
                                @for (row of payments.data()?.items; track $index) {
                                  <div class="space-y-1 py-3">
                                    <p class="font-semibold tabular-nums">
                                      {{ formatCashAmount(row.amountMinor, row.currency) }}
                                    </p>
                                    <p class="flex items-center gap-2 text-sm">
                                      <mat-icon aria-hidden="true">{{
                                        paymentIcon(row.method)
                                      }}</mat-icon
                                      >{{ 'RESTAURANTS.CASH.' + row.method | transloco }}
                                    </p>
                                    <p class="text-sm text-app-muted">
                                      {{ timestamp(row.capturedAt) }}
                                    </p>
                                    <p class="text-sm text-app-muted">
                                      {{ row.tableDisplayName ?? '—' }}
                                    </p>
                                    <p class="text-sm text-app-muted">
                                      {{ 'RESTAURANTS.CASH.PAYMENT_REFERENCE' | transloco }}:
                                      {{ row.paymentReference ?? '—' }}
                                    </p>
                                    <liass-status-chip
                                      [label]="'RESTAURANTS.CASH.CAPTURED' | transloco"
                                      tone="success"
                                      size="sm"
                                    />
                                  </div>
                                }
                              </div>
                              @if (payments.data()?.items?.length === 0) {
                                <p
                                  class="rounded-app-card border border-dashed border-app-border bg-app-surface-muted p-3 text-sm text-app-muted"
                                >
                                  {{ 'RESTAURANTS.CASH.NO_PAYMENTS' | transloco }}
                                </p>
                              }
                              @if (payments.data()?.nextCursor; as cursor) {
                                <button mat-button (click)="paymentCursor.set(cursor)">
                                  {{ 'RESTAURANTS.CASH.MORE' | transloco }}
                                </button>
                              }
                            }
                          </section></ng-template
                        ></mat-tab
                      ><mat-tab labelClass="!min-w-0 !px-2 sm:!px-6"
                        ><ng-template mat-tab-label
                          ><span class="inline-flex items-center gap-2 whitespace-nowrap"
                            ><mat-icon class="hidden sm:inline-flex" aria-hidden="true"
                              >swap_vert</mat-icon
                            ><span class="sm:hidden">{{
                              'RESTAURANTS.CASH.MOVEMENTS_SHORT' | transloco
                            }}</span>
                            <span class="hidden sm:inline">{{
                              'RESTAURANTS.CASH.MOVEMENTS' | transloco
                            }}</span>
                            @if (s.cashMovementCount !== undefined) {
                              <span>· {{ s.cashMovementCount }}</span>
                            }
                          </span></ng-template
                        >
                        <ng-template matTabContent>
                          <section
                            class="space-y-3 pt-3"
                            data-activity-movements
                            data-personal-movements
                          >
                            @if (movements.isPending()) {
                              <p role="status">{{ 'RESTAURANTS.CASH.LOADING' | transloco }}</p>
                            } @else if (movements.isError()) {
                              <p role="alert">{{ 'RESTAURANTS.CASH.ERROR' | transloco }}</p>
                            } @else {
                              <div class="hidden overflow-x-auto lg:block">
                                <table class="liass-data-table w-full text-left text-sm">
                                  <thead>
                                    <tr>
                                      <th scope="col" class="px-3 text-left">
                                        {{ 'RESTAURANTS.CASH.DATE_TIME' | transloco }}
                                      </th>
                                      <th scope="col" class="px-3 text-left">
                                        {{ 'RESTAURANTS.CASH.TYPE' | transloco }}
                                      </th>
                                      <th scope="col" class="px-3 text-right">
                                        {{ 'RESTAURANTS.CASH.AMOUNT' | transloco }}
                                      </th>
                                      <th scope="col" class="px-3 text-left">
                                        {{ 'RESTAURANTS.CASH.REASON_COLUMN' | transloco }}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    @for (row of movements.data()?.items; track $index) {
                                      <tr>
                                        <td class="px-3 text-left">
                                          {{ timestamp(row.occurredAt) }}
                                        </td>
                                        <td class="px-3 text-left">
                                          <span class="inline-flex items-center gap-2"
                                            ><mat-icon aria-hidden="true">{{
                                              row.type === 'CASH_IN'
                                                ? 'arrow_downward'
                                                : 'arrow_upward'
                                            }}</mat-icon
                                            >{{ 'RESTAURANTS.CASH.' + row.type | transloco }}</span
                                          >
                                        </td>
                                        <td class="px-3 text-right tabular-nums whitespace-nowrap">
                                          {{ formatCashAmount(row.amountMinor, row.currency) }}
                                        </td>
                                        <td class="px-3 text-left">{{ row.reason }}</td>
                                      </tr>
                                    }
                                  </tbody>
                                </table>
                              </div>
                              <div class="divide-y divide-app-border lg:hidden">
                                @for (row of movements.data()?.items; track $index) {
                                  <div class="space-y-1 py-3">
                                    <div class="flex items-start justify-between gap-3">
                                      <p class="flex items-center gap-2 text-sm">
                                        <mat-icon aria-hidden="true">{{
                                          row.type === 'CASH_IN' ? 'arrow_downward' : 'arrow_upward'
                                        }}</mat-icon
                                        >{{ 'RESTAURANTS.CASH.' + row.type | transloco }}
                                      </p>
                                      <p class="shrink-0 font-semibold tabular-nums">
                                        {{ formatCashAmount(row.amountMinor, row.currency) }}
                                      </p>
                                    </div>
                                    <p class="text-sm text-app-muted">
                                      {{ timestamp(row.occurredAt) }}
                                    </p>
                                    <p>{{ row.reason }}</p>
                                  </div>
                                }
                              </div>
                              @if (movements.data()?.items?.length === 0) {
                                <p
                                  class="rounded-app-card border border-dashed border-app-border bg-app-surface-muted p-3 text-sm text-app-muted"
                                >
                                  {{ 'RESTAURANTS.CASH.NO_MOVEMENTS' | transloco }}
                                </p>
                              }
                              @if (movements.data()?.nextCursor; as cursor) {
                                <button mat-button (click)="movementCursor.set(cursor)">
                                  {{ 'RESTAURANTS.CASH.MORE' | transloco }}
                                </button>
                              }
                            }
                          </section></ng-template
                        ></mat-tab
                      ></mat-tab-group
                    >
                  </section>
                } @else if (current.isSuccess()) {
                  <button mat-flat-button (click)="openCash()">
                    {{ 'RESTAURANTS.CASH.OPEN_CASH' | transloco }}
                  </button>
                }
              }
            }
          </div></liass-card
        >
      </div></mat-drawer-content
    >
    @if (management) {
      <mat-drawer
        position="end"
        mode="over"
        [opened]="!!selected()"
        (closedStart)="selected.set('')"
        class="w-full max-w-[480px] border-l border-app-border bg-app-surface p-4"
        data-session-detail
      >
        @if (session(); as s) {
          <div class="space-y-5" [attr.aria-label]="identity(s)">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-lg font-semibold">{{ identity(s) }}</h2>
              <button
                mat-icon-button
                (click)="selected.set('')"
                [attr.aria-label]="'COMMON.ACTIONS.CLOSE' | transloco"
              >
                <mat-icon>close</mat-icon>
              </button>
            </div>
            <section class="space-y-2 border-t border-app-border pt-3" data-detail-session>
              <h3 class="font-semibold">{{ 'RESTAURANTS.CASH.SESSION' | transloco }}</h3>
              <p>{{ identity(s) }}</p>
              <liass-status-chip
                [label]="'RESTAURANTS.CASH.' + s.status | transloco"
                [tone]="s.status === 'OPEN' ? 'success' : 'neutral'"
                size="sm"
              />
              <p>{{ 'RESTAURANTS.CASH.OPENED_AT' | transloco }}: {{ timestamp(s.openedAt) }}</p>
              @if (s.closedAt) {
                <p>{{ 'RESTAURANTS.CASH.CLOSED_AT' | transloco }}: {{ timestamp(s.closedAt) }}</p>
              }
            </section>
            <section class="space-y-2 border-t border-app-border pt-3" data-detail-reconciliation>
              <h3 class="font-semibold">{{ 'RESTAURANTS.CASH.RECONCILIATION' | transloco }}</h3>
              @for (value of reconciliation(s); track value.key) {
                <div class="flex justify-between gap-4">
                  <span>{{ 'RESTAURANTS.CASH.' + value.key | transloco }}</span
                  ><span class="tabular-nums"
                    >{{ value.amount === undefined ? '—' : formatNumber(value.amount) }}
                    {{ value.amount === undefined ? '' : s.currency }}</span
                  >
                </div>
              }
              <div class="flex justify-between gap-4">
                <span>{{ 'RESTAURANTS.CASH.VARIANCE' | transloco }}</span
                ><span class="tabular-nums"
                  >{{ s.status === 'CLOSED' ? signed(s.varianceAmountMinor) : '—' }}
                  {{
                    s.status === 'CLOSED' && s.varianceAmountMinor !== undefined ? s.currency : ''
                  }}</span
                >
              </div>
            </section>
            <section
              class="space-y-2 border-t border-app-border pt-3"
              data-detail-other-collections
            >
              <h3 class="font-semibold">{{ 'RESTAURANTS.CASH.OTHER_COLLECTIONS' | transloco }}</h3>
              @for (value of otherCollections(s); track value.key) {
                <div class="flex justify-between gap-4">
                  <span>{{ 'RESTAURANTS.CASH.' + value.key | transloco }}</span
                  ><span class="tabular-nums"
                    >{{ formatNumber(value.amount) }} {{ s.currency }}</span
                  >
                </div>
              }
            </section>
            <section class="space-y-2 border-t border-app-border pt-3" data-detail-activity>
              <h3 class="font-semibold">{{ 'RESTAURANTS.CASH.ACTIVITY' | transloco }}</h3>
              <p>{{ 'RESTAURANTS.CASH.PAYMENT_COUNT' | transloco }}: {{ s.paymentCount }}</p>
              <h4>{{ 'RESTAURANTS.CASH.MOVEMENTS' | transloco }}</h4>
              @for (m of movements.data()?.items; track m.movementId) {
                <div class="border-t border-app-border py-2">
                  {{ 'RESTAURANTS.CASH.' + m.type | transloco }} · {{ formatNumber(m.amountMinor) }}
                  {{ m.currency }} · {{ timestamp(m.occurredAt) }}
                  <p>{{ m.reason }}</p>
                </div>
              }
              @if (movements.data()?.nextCursor; as cursor) {
                <button mat-button (click)="movementCursor.set(cursor)">
                  {{ 'RESTAURANTS.CASH.MORE' | transloco }}
                </button>
              }
            </section>
          </div>
        } @else if (detail.isPending()) {
          <p role="status">{{ 'RESTAURANTS.CASH.LOADING' | transloco }}</p>
        }
      </mat-drawer>
    }
  </mat-drawer-container>`,
})
export class RestaurantCashPage {
  readonly cash = inject(RestaurantCashQueries);
  readonly i18n = inject(TranslocoService);
  formatCashAmount(amountMinor: number, currency: string) {
    return formatExactMoney(String(amountMinor), currency, this.i18n.getActiveLang());
  }
  formatNumber(value: number | undefined) {
    if (value === undefined) return '—';
    return new Intl.NumberFormat(this.i18n.getActiveLang(), {
      maximumFractionDigits: 0,
      useGrouping: true,
    }).format(value);
  }
  paymentIcon(method: string) {
    return method === 'CASH' ? 'payments' : method === 'CARD' ? 'credit_card' : 'smartphone';
  }
  identity(s: c.RestaurantCashSession) {
    return (
      s.cashierDisplayName?.trim() ||
      this.i18n.translate(
        'RESTAURANTS.CASH.' +
          (s.cashierUserId === this.context().user ? 'YOU' : 'IDENTITY_UNAVAILABLE'),
      )
    );
  }
  timestamp(value: string | undefined) {
    if (!value) return '—';
    return new Intl.DateTimeFormat(this.i18n.getActiveLang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: this.activeDay()?.operationalTimezone,
    }).format(new Date(value));
  }
  businessDate(value: string) {
    return new Intl.DateTimeFormat(this.i18n.getActiveLang(), {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }
  readonly caps = inject(RestaurantsCapabilities);
  readonly dialog = inject(MatDialog);
  readonly management = inject(ActivatedRoute).snapshot.data['cashManagement'] === true;
  readonly activityTab = signal(0);
  readonly paymentCursor = signal<string | undefined>(undefined);
  readonly selected = signal('');
  readonly closedDay = signal('');
  readonly movementCursor = signal<string | undefined>(undefined);
  readonly context = computed(() => this.cash.context());
  constructor() {
    let prior = JSON.stringify(this.context());
    effect(() => {
      const next = JSON.stringify(this.context());
      if (next !== prior) {
        prior = next;
        this.selected.set('');
        this.closedDay.set('');
        this.movementCursor.set(undefined);
        this.paymentCursor.set(undefined);
        this.activityTab.set(0);
      }
    });
  }

  readonly day = injectQuery(() => this.cash.day(this.context()));
  readonly historical = injectQuery(() => this.cash.businessDay(this.context(), this.closedDay()));
  readonly activeDay = computed(() => this.day.data()?.data ?? this.historical.data()?.data);
  readonly current = injectQuery(() => this.cash.current(this.context()));
  readonly detail = injectQuery(() => this.cash.detail(this.context(), this.selected()));
  readonly session = computed(() =>
    this.selected()
      ? this.detail.data()?.data
      : this.management
        ? undefined
        : this.current.data()?.data,
  );
  readonly summary = injectQuery(() =>
    this.cash.summary(
      this.context(),
      this.activeDay()?.businessDayId ?? '',
      this.management && this.caps.canManageSetup(),
    ),
  );
  readonly movements = injectQuery(() =>
    this.cash.movements(
      this.context(),
      this.management || this.activityTab() === 1 ? (this.session()?.cashSessionId ?? '') : '',
      this.movementCursor(),
    ),
  );
  readonly payments = injectQuery(() =>
    this.cash.payments(
      this.context(),
      !this.management && this.activityTab() === 0 ? (this.session()?.cashSessionId ?? '') : '',
      this.paymentCursor(),
    ),
  );
  readonly columns = [
    'CASHIER',
    'OPENED_AT',
    'STATUS',
    'CASH',
    'MOBILE_MONEY',
    'CARD',
    'EXPECTED',
    'COUNTED',
    'VARIANCE',
    'ACTIONS',
  ].map((id) => ({
    id,
    labelKey: 'RESTAURANTS.CASH.' + id,
    required: ['CASHIER', 'ACTIONS'].includes(id),
  }));
  readonly visibleColumns = signal(loadTablePreferences('restaurants.cash.sessions', this.columns));
  preferences() {
    this.dialog
      .open(LiassTablePreferencesDialogComponent, {
        width: '540px',
        maxWidth: '95vw',
        data: {
          tableId: 'restaurants.cash.sessions',
          columns: this.columns,
          visibleColumnIds: this.visibleColumns(),
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result)
          this.visibleColumns.set(
            saveTablePreferences(
              'restaurants.cash.sessions',
              this.columns,
              result.visibleColumnIds,
            ),
          );
      });
  }
  readonly search = inject(FormBuilder).nonNullable.control('');
  filtered(rows: c.RestaurantCashSessionSummary[]) {
    const term = this.search.value.trim().toLocaleLowerCase();
    return rows.filter(
      (row) => !term || row.session.cashierDisplayName?.toLocaleLowerCase().includes(term),
    );
  }
  inspect(cashSessionId: string) {
    this.movementCursor.set(undefined);
    this.selected.set(cashSessionId);
  }
  signed(n: number | undefined) {
    return n === undefined ? '—' : (n > 0 ? '+' : '') + n.toLocaleString(this.i18n.getActiveLang());
  }
  personalSecondaryAmounts(s: c.RestaurantCashSession) {
    return [
      { key: 'MOBILE_MONEY', amount: s.paidByMethodMinor.MOBILE_MONEY },
      { key: 'CARD', amount: s.paidByMethodMinor.CARD },
      { key: 'PAYMENT_COUNT', amount: s.paymentCount },
    ];
  }
  reconciliation(s: c.RestaurantCashSession) {
    return [
      { key: 'FLOAT', amount: s.openingCashAmountMinor },
      { key: 'CASH', amount: s.paidByMethodMinor.CASH },
      { key: 'CASH_IN', amount: s.cashInMinor },
      { key: 'CASH_OUT', amount: s.cashOutMinor },
      { key: 'EXPECTED', amount: s.expectedCashAmountMinor },
      { key: 'COUNTED', amount: s.status === 'CLOSED' ? s.countedCashAmountMinor : undefined },
    ];
  }
  otherCollections(s: c.RestaurantCashSession) {
    return [
      { key: 'MOBILE_MONEY', amount: s.paidByMethodMinor.MOBILE_MONEY },
      { key: 'CARD', amount: s.paidByMethodMinor.CARD },
    ];
  }
  command(
    label: string,
    execute: (amount: number, reason: string) => Promise<void>,
    amount?: string,
    name?: string,
    reason = false,
    session?: c.RestaurantCashSession,
  ) {
    this.dialog.open(RestaurantCashCommandDialog, {
      width: '480px',
      maxWidth: '95vw',
      data: {
        label,
        locale: this.i18n.getActiveLang(),
        session,
        execute,
        amount,
        name,
        reason,
        context: this.cash.outlet.outlet()?.name ?? '',
        currency: this.activeDay()?.currency ?? '',
      },
    });
  }
  openDay() {
    const ctx = this.context();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.command('OPEN_DAY', async () => {
      const r = await this.cash.command(
        ctx,
        'business-days/open',
        { operationalTimezone: zone },
        c.RestaurantBusinessDayResponseSchema,
      );
      await this.cash.confirmedDay(ctx, r.data);
    });
  }
  openCash() {
    const ctx = this.context();
    this.command(
      'OPEN_CASH',
      async (amount) => {
        const r = await this.cash.command(
          ctx,
          'cash-sessions',
          { openingCashAmountMinor: amount },
          c.RestaurantCashSessionResponseSchema,
        );
        await this.cash.confirmedSession(ctx, r.data);
      },
      'FLOAT',
    );
  }
  move(s: c.RestaurantCashSession, type: 'CASH_IN' | 'CASH_OUT') {
    const ctx = this.context();
    this.command(
      type,
      async (amount, reason) => {
        const result = await this.cash.command(
          ctx,
          `cash-sessions/${s.cashSessionId}/movements`,
          { expectedVersion: s.version, type, amountMinor: amount, reason },
          c.RestaurantCashMovementResponseSchema,
        );
        await this.cash.confirmedMovement(ctx, result.data, result.session);
      },
      'AMOUNT',
      s.cashierDisplayName ?? undefined,
      true,
    );
  }
  closeLabel(s: c.RestaurantCashSession) {
    return s.cashierUserId === this.context().user
      ? 'CLOSE_OWN'
      : s.cashierDisplayName?.trim()
        ? 'CLOSE_NAMED'
        : 'CLOSE_THIS';
  }
  close(s: c.RestaurantCashSession) {
    const ctx = this.context();
    this.command(
      this.closeLabel(s),
      async (amount) => {
        const r = await this.cash.command(
          ctx,
          `cash-sessions/${s.cashSessionId}/close`,
          { expectedVersion: s.version, countedCashAmountMinor: amount },
          c.RestaurantCashSessionResponseSchema,
        );
        await this.cash.confirmedSession(ctx, r.data);
        this.selected.set(s.cashSessionId);
      },
      'COUNTED',
      s.cashierDisplayName ?? undefined,
      false,
      s,
    );
  }
  closeDay() {
    const ctx = this.context(),
      d = this.summary.data()?.data.businessDay ?? this.activeDay();
    if (!d) return;
    this.command('CLOSE_DAY', async () => {
      const r = await this.cash.command(
        ctx,
        `business-days/${d.businessDayId}/close`,
        { expectedVersion: d.version },
        c.RestaurantBusinessDayResponseSchema,
      );
      await this.cash.confirmedDay(ctx, r.data);
      this.closedDay.set(d.businessDayId);
    });
  }
}
