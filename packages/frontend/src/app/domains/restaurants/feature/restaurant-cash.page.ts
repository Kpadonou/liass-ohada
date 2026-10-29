import { LiassTablePreferencesDialogComponent } from '../../../shared/ui/table-preferences/table-preferences-dialog.component';
import {
  loadTablePreferences,
  saveTablePreferences,
} from '../../../shared/ui/table-preferences/table-preferences.storage';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoModule } from '@ngneat/transloco';
import * as c from '@liass-ohada/shared/restaurants';
import { RestaurantCashQueries } from '../data-access/restaurant-cash.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
@Component({
  selector: 'liass-cash-command',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TranslocoModule,
  ],
  template: ` <h2 mat-dialog-title>
      {{ 'RESTAURANTS.CASH.' + data.label | transloco }} {{ data.name }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="space-y-4">
        <p>{{ data.context }} · {{ data.currency }}</p>
        @if (data.session; as session) {
          <dl class="grid grid-cols-2 gap-2">
            @for (item of drawer(session); track item.key) {
              <dt>{{ 'RESTAURANTS.CASH.' + item.key | transloco }}</dt>
              <dd>{{ item.amount | number }} {{ session.currency }}</dd>
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
          {{ 'RESTAURANTS.CASH.' + data.label | transloco }}
        </button></mat-dialog-actions
      >
    </form>`,
})
export class RestaurantCashCommandDialog {
  readonly data = inject<{
    label: string;
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
    return (v > 0 ? '+' : '') + v.toLocaleString();
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
    DatePipe,
    DecimalPipe,
    RouterLink,
    TranslocoModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  template: ` <div class="space-y-5">
    <header class="border-b border-app-border pb-4">
      <h1 class="text-2xl font-semibold">
        {{ 'RESTAURANTS.CASH.' + (management ? 'DAY_REVIEW' : 'MY_CASH') | transloco }}
      </h1>
      <p>{{ cash.outlet.outlet()?.name }}</p>
    </header>
    <section class="rounded-xl border border-app-border bg-app-surface p-4 space-y-4">
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
        @if (activeDay(); as d) {
          <h2>
            {{ 'RESTAURANTS.CASH.DAY' | transloco }}
            {{ d.businessDate | date: 'mediumDate' : 'UTC' }}
          </h2>
          <p>
            {{
              d.status === 'OPEN'
                ? ('RESTAURANTS.CASH.OPEN' | transloco)
                : ('RESTAURANTS.CASH.CLOSED' | transloco)
            }}
            · {{ d.openedAt | date: 'medium' }} · {{ d.operationalTimezone }}
          </p>
          @if (d.closedAt) {
            <p>{{ d.closedAt | date: 'medium' }}</p>
          }
        }
        @if (management && caps.canManageSetup()) {
          @if (summary.data()?.data; as totals) {
            <p>
              {{ 'RESTAURANTS.CASH.COLLECTIONS' | transloco }} :
              {{ totals.totalPaymentsMinor | number }} {{ activeDay()?.currency }}
            </p>
            <p>
              {{ 'RESTAURANTS.CASH.OPEN_SESSIONS' | transloco }} : {{ totals.openSessionCount }} ·
              {{ 'RESTAURANTS.CASH.CLOSED_SESSIONS' | transloco }} : {{ totals.closedSessionCount }}
            </p>
            <button
              mat-flat-button
              [disabled]="totals.openSessionCount > 0 || activeDay()?.status !== 'OPEN'"
              (click)="closeDay()"
            >
              {{ 'RESTAURANTS.CASH.CLOSE_DAY' | transloco }}
            </button>
            <mat-form-field class="w-full sm:max-w-sm"
              ><mat-label>{{ 'RESTAURANTS.CASH.SEARCH' | transloco }}</mat-label
              ><input matInput [formControl]="search"
            /></mat-form-field>
            <div class="divide-y divide-app-border md:hidden">
              @for (row of filtered(totals.sessions); track row.session.cashSessionId) {
                <div class="py-3 space-y-2">
                  <strong>{{
                    row.session.cashierDisplayName || ('RESTAURANTS.CASH.CASHIER' | transloco)
                  }}</strong>
                  <p>
                    {{ 'RESTAURANTS.CASH.' + row.session.status | transloco }} ·
                    {{ row.session.openedAt | date: 'short' }}
                  </p>
                  <p>
                    {{ 'RESTAURANTS.CASH.EXPECTED' | transloco }} :
                    {{ row.session.expectedCashAmountMinor | number }} {{ row.session.currency }}
                  </p>
                  <p>
                    {{ 'RESTAURANTS.CASH.VARIANCE' | transloco }} :
                    {{ signed(row.session.varianceAmountMinor) }} {{ row.session.currency }}
                  </p>
                  <button mat-button (click)="selected.set(row.session.cashSessionId)">
                    {{ 'RESTAURANTS.CASH.DETAIL' | transloco }}
                  </button>
                </div>
              }
            </div>
            <button mat-button (click)="preferences()">
              {{ 'RESTAURANTS.CASH.COLUMNS' | transloco }}
            </button>
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full text-sm">
                <thead>
                  <tr>
                    <th>{{ 'RESTAURANTS.CASH.CASHIER' | transloco }}</th>
                    @if (visibleColumns().includes('OPENED_AT')) {
                      <th>{{ 'RESTAURANTS.CASH.OPENED_AT' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('COUNTED')) {
                      <th>{{ 'RESTAURANTS.CASH.COUNTED' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('STATUS')) {
                      <th>{{ 'RESTAURANTS.CASH.STATUS' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('CASH')) {
                      <th>{{ 'RESTAURANTS.CASH.CASH' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('MOBILE_MONEY')) {
                      <th>{{ 'RESTAURANTS.CASH.MOBILE_MONEY' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('CARD')) {
                      <th>{{ 'RESTAURANTS.CASH.CARD' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('EXPECTED')) {
                      <th>{{ 'RESTAURANTS.CASH.EXPECTED' | transloco }}</th>
                    }
                    @if (visibleColumns().includes('VARIANCE')) {
                      <th>{{ 'RESTAURANTS.CASH.VARIANCE' | transloco }}</th>
                    }
                    <th>{{ 'RESTAURANTS.CASH.ACTIONS' | transloco }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of filtered(totals.sessions); track row.session.cashSessionId) {
                    <tr class="border-t border-app-border">
                      <td>
                        {{
                          row.session.cashierDisplayName || ('RESTAURANTS.CASH.CASHIER' | transloco)
                        }}
                      </td>
                      @if (visibleColumns().includes('OPENED_AT')) {
                        <td>{{ row.session.openedAt | date: 'short' }}</td>
                      }
                      @if (visibleColumns().includes('COUNTED')) {
                        <td>{{ row.session.countedCashAmountMinor | number }}</td>
                      }
                      @if (visibleColumns().includes('STATUS')) {
                        <td>{{ 'RESTAURANTS.CASH.' + row.session.status | transloco }}</td>
                      }
                      @if (visibleColumns().includes('CASH')) {
                        <td>{{ row.session.paidByMethodMinor.CASH | number }}</td>
                      }
                      @if (visibleColumns().includes('MOBILE_MONEY')) {
                        <td>{{ row.session.paidByMethodMinor.MOBILE_MONEY | number }}</td>
                      }
                      @if (visibleColumns().includes('CARD')) {
                        <td>{{ row.session.paidByMethodMinor.CARD | number }}</td>
                      }
                      @if (visibleColumns().includes('EXPECTED')) {
                        <td>{{ row.session.expectedCashAmountMinor | number }}</td>
                      }
                      @if (visibleColumns().includes('VARIANCE')) {
                        <td>{{ signed(row.session.varianceAmountMinor) }}</td>
                      }
                      <td>
                        <button mat-button (click)="selected.set(row.session.cashSessionId)">
                          {{ 'RESTAURANTS.CASH.DETAIL' | transloco }}
                        </button>
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
        @if (session(); as s) {
          <h2>{{ s.cashierDisplayName || ('RESTAURANTS.CASH.MY_CASH' | transloco) }}</h2>
          <p>
            {{ 'RESTAURANTS.CASH.' + s.status | transloco }} · {{ s.openedAt | date: 'medium' }}
          </p>
          <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            @for (value of amounts(s); track value.key) {
              <div>
                <dt>{{ 'RESTAURANTS.CASH.' + value.key | transloco }}</dt>
                <dd class="font-semibold">{{ value.amount | number }} {{ s.currency }}</dd>
              </div>
            }
          </dl>
          @if (s.status === 'OPEN') {
            @if (caps.canManageSetup()) {
              <button mat-button (click)="move(s, 'CASH_IN')">
                {{ 'RESTAURANTS.CASH.CASH_IN' | transloco }}</button
              ><button mat-button (click)="move(s, 'CASH_OUT')">
                {{ 'RESTAURANTS.CASH.CASH_OUT' | transloco }}
              </button>
            }
            <button mat-flat-button (click)="close(s)">
              {{ 'RESTAURANTS.CASH.CLOSE_CASH' | transloco }}
            </button>
          } @else {
            <p>
              {{ 'RESTAURANTS.CASH.COUNTED' | transloco }} : {{ s.countedCashAmountMinor | number }}
              {{ s.currency }} · {{ 'RESTAURANTS.CASH.VARIANCE' | transloco }} :
              {{ signed(s.varianceAmountMinor) }} {{ s.currency }} ·
              {{ s.closedAt | date: 'medium' }}
            </p>
          }
          <h3>{{ 'RESTAURANTS.CASH.MOVEMENTS' | transloco }}</h3>
          @for (m of movements.data()?.items; track m.movementId) {
            <div class="border-t border-app-border py-2">
              <span
                >{{ 'RESTAURANTS.CASH.' + m.type | transloco }} · {{ m.amountMinor | number }}
                {{ m.currency }} · {{ m.occurredAt | date: 'medium' }}</span
              >
              <p>{{ m.reason }}</p>
            </div>
          }
          @if (movements.data()?.nextCursor; as cursor) {
            <button mat-button (click)="movementCursor.set(cursor)">
              {{ 'RESTAURANTS.CASH.MORE' | transloco }}
            </button>
          }
        } @else if (!management && current.isSuccess()) {
          <button mat-flat-button (click)="openCash()">
            {{ 'RESTAURANTS.CASH.OPEN_CASH' | transloco }}
          </button>
        }
      }
    </section>
  </div>`,
})
export class RestaurantCashPage {
  readonly cash = inject(RestaurantCashQueries);
  readonly caps = inject(RestaurantsCapabilities);
  readonly dialog = inject(MatDialog);
  readonly management = inject(ActivatedRoute).snapshot.data['cashManagement'] === true;
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
      }
    });
  }

  readonly day = injectQuery(() => this.cash.day(this.context()));
  readonly historical = injectQuery(() => this.cash.businessDay(this.context(), this.closedDay()));
  readonly activeDay = computed(() => this.day.data()?.data ?? this.historical.data()?.data);
  readonly current = injectQuery(() => this.cash.current(this.context()));
  readonly detail = injectQuery(() => this.cash.detail(this.context(), this.selected()));
  readonly session = computed(() =>
    this.selected() ? this.detail.data()?.data : this.current.data()?.data,
  );
  readonly summary = injectQuery(() =>
    this.cash.summary(
      this.context(),
      this.activeDay()?.businessDayId ?? '',
      this.management && this.caps.canManageSetup(),
    ),
  );
  readonly movements = injectQuery(() =>
    this.cash.movements(this.context(), this.session()?.cashSessionId ?? '', this.movementCursor()),
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
  signed(n: number | undefined) {
    return n === undefined ? '—' : (n > 0 ? '+' : '') + n.toLocaleString();
  }
  amounts(s: c.RestaurantCashSession) {
    return [
      { key: 'PAYMENT_COUNT', amount: s.paymentCount },
      { key: 'FLOAT', amount: s.openingCashAmountMinor },
      { key: 'COLLECTIONS', amount: Object.values(s.paidByMethodMinor).reduce((a, b) => a + b, 0) },
      { key: 'CASH', amount: s.paidByMethodMinor.CASH },
      { key: 'MOBILE_MONEY', amount: s.paidByMethodMinor.MOBILE_MONEY },
      { key: 'CARD', amount: s.paidByMethodMinor.CARD },
      { key: 'CASH_IN', amount: s.cashInMinor },
      { key: 'CASH_OUT', amount: s.cashOutMinor },
      { key: 'EXPECTED', amount: s.expectedCashAmountMinor },
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
        await this.cash.confirmedMovement(ctx, result.data);
      },
      'AMOUNT',
      s.cashierDisplayName ?? undefined,
      true,
    );
  }
  close(s: c.RestaurantCashSession) {
    const ctx = this.context();
    this.command(
      'CLOSE_CASH',
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
