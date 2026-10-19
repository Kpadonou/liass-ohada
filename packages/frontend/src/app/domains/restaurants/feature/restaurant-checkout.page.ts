import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { RestaurantCheckoutVisitComponent } from './restaurant-checkout-visit.component';
import { tableDisplayName } from '../utils/table-display-name';
import { restaurantPrice } from '../utils/restaurant-money';
@Component({
  selector: 'liass-restaurant-checkout',
  host: { class: 'block min-w-0' },
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoModule,
    LiassPageHeaderComponent,
    LiassSearchableSelectComponent,
    RestaurantCheckoutVisitComponent,
  ],
  template: `
    <liass-page-header eyebrow="" subtitle="" [title]="'RESTAURANTS.CHECKOUT.TITLE' | transloco" />
    @if (allowed()) {
      <div class="mt-3 max-w-md">
        <liass-searchable-select
          labelKey="RESTAURANTS.CHECKOUT.OUTLET"
          [options]="outletOptions()"
          [ngModel]="outletId()"
          (ngModelChange)="selectOutlet($event)"
        />
      </div>
      @if (outlets().pending) {
        <p role="status">{{ 'RESTAURANTS.CHECKOUT.LOADING' | transloco }}</p>
      }
      @if (outlets().error) {
        <p role="alert">{{ 'RESTAURANTS.CHECKOUT.READ_ERROR' | transloco }}</p>
      }
      @if (outlets().success && !outletOptions().length) {
        <p>
          {{
            (caps.canManageSetup()
              ? 'RESTAURANTS.CHECKOUT.NO_MANAGEMENT_OUTLETS'
              : 'RESTAURANTS.CHECKOUT.NO_OUTLETS'
            ) | transloco
          }}
        </p>
      }
      @if (outlets().next) {
        <button mat-button type="button" (click)="outlets().fetch()">
          {{ 'RESTAURANTS.CHECKOUT.MORE_OUTLETS' | transloco }}
        </button>
      }
      @if (outletId()) {
        <div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <section class="min-w-0">
            <mat-form-field class="w-full"
              ><mat-label>{{ 'RESTAURANTS.CHECKOUT.SEARCH' | transloco }}</mat-label
              ><input
                matInput
                #tableSearch
                [ngModel]="search()"
                (ngModelChange)="search.set($event)"
            /></mat-form-field>
            @if (floor.isPending()) {
              <p role="status">{{ 'RESTAURANTS.CHECKOUT.LOADING' | transloco }}</p>
            }
            @if (floor.isError()) {
              <p role="alert">{{ 'RESTAURANTS.CHECKOUT.READ_ERROR' | transloco }}</p>
            }
            @for (table of occupied(); track table.tableId) {
              <button
                type="button"
                mat-stroked-button
                class="mb-2 w-full !h-auto !justify-start !py-3 !text-left"
                (click)="sessionId.set(table.guestSessionId)"
              >
                <span class="block break-words">{{ displayName(table) }}</span
                ><span class="block text-xs"
                  >{{ 'RESTAURANTS.CHECKOUT.ADDITION' | transloco }} ·
                  {{ money(table.currentAmountMinor, table.currency) }}</span
                >
              </button>
            }
            @if (floor.isSuccess() && !occupied().length) {
              <p>{{ 'RESTAURANTS.CHECKOUT.NO_TABLES' | transloco }}</p>
            }
            @if (floor.hasNextPage()) {
              <button
                type="button"
                mat-button
                (click)="floor.fetchNextPage()"
                [disabled]="floor.isFetchingNextPage()"
              >
                {{ 'RESTAURANTS.CHECKOUT.MORE_TABLES' | transloco }}
              </button>
            }
          </section>
          <section class="min-w-0 rounded-app-card border border-app-border bg-app-surface p-4">
            @for (context of selectedContext(); track context.key) {
              <liass-checkout-visit
                [ctx]="context.ctx"
                (closed)="released()"
                (accessDenied)="denyCheckout()"
              />
            }
            @if (!sessionId()) {
              <p class="text-app-text-secondary">
                {{ 'RESTAURANTS.CHECKOUT.SELECT_TABLE' | transloco }}
              </p>
            }
            @if (message()) {
              <p role="status">{{ message() }}</p>
            }
          </section>
        </div>
      }
    } @else {
      <p role="alert">{{ 'RESTAURANTS.CHECKOUT.ACCESS' | transloco }}</p>
      <button mat-button type="button" (click)="recoverAccess()">
        {{ 'RESTAURANTS.CHECKOUT.REFRESH_ACCESS' | transloco }}
      </button>
    }
  `,
})
export class RestaurantCheckoutPage {
  private readonly auth = inject(AuthStore);
  readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly state = inject(RestaurantAccessState);
  private readonly queries = inject(RestaurantsQueries);
  private readonly t = inject(TranslocoService);
  private readonly tableSearch = viewChild<ElementRef<HTMLInputElement>>('tableSearch');
  readonly outletId = signal('');
  readonly sessionId = signal('');
  readonly search = signal('');
  readonly message = signal('');
  readonly identity = computed(() =>
    JSON.stringify({
      org: this.auth.effectiveOrgId(),
      user: this.auth.currentUserId(),
      revision: this.auth.contextRevision(),
    }),
  );
  private readonly deniedScope = signal('');
  readonly allowed = computed(
    () =>
      this.deniedScope() !== this.identity() &&
      this.caps.canReadCheckout() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      ['management', 'checkout'].includes(this.state.mode()),
  );
  readonly managementOutlets = injectInfiniteQuery(() =>
    this.queries.list('outlet', {}, this.allowed() && this.caps.canManageSetup()),
  );
  readonly selfOutlets = injectInfiniteQuery(() =>
    this.queries.myOutlets(this.allowed() && !this.caps.canManageSetup()),
  );
  readonly outlets = computed(() => {
    const q = this.caps.canManageSetup() ? this.managementOutlets : this.selfOutlets;
    return {
      pending: q.status() === 'pending',
      error: q.status() === 'error',
      success: q.status() === 'success',
      next: q.hasNextPage(),
      fetch: () => q.fetchNextPage(),
    };
  });
  readonly outletOptions = computed(() =>
    this.outlets().error
      ? []
      : this.caps.canManageSetup()
        ? (this.managementOutlets
            .data()
            ?.pages.flatMap((page) => page.items)
            .filter((row) => row.isActive)
            .map((row) => ({ value: row.id, label: row.name })) ?? [])
        : (this.selfOutlets
            .data()
            ?.pages.flatMap((page) => page.items)
            .map((row) => ({ value: row.outletId, label: row.name })) ?? []),
  );
  readonly floor = injectInfiniteQuery(() => ({
    ...this.queries.serviceFloor(
      this.outletId(),
      this.allowed() && this.outletOptions().some((row) => row.value === this.outletId()),
    ),
    refetchInterval: false as const,
  }));
  readonly floorDenied = computed(() => {
    const error = this.floor.error();
    return error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status);
  });
  readonly occupied = computed(
    () =>
      (this.floorDenied() ? undefined : this.floor.data())?.pages
        .flatMap((page) => page.items)
        .filter(
          (table): table is Extract<typeof table, { state: 'OCCUPIED' }> =>
            table.state === 'OCCUPIED',
        )
        .filter((table) =>
          this.displayName(table).toLocaleLowerCase().includes(this.search().toLocaleLowerCase()),
        ) ?? [],
  );
  readonly selectedContext = computed(() =>
    this.allowed() &&
    !this.floorDenied() &&
    this.sessionId() &&
    this.outletOptions().some((row) => row.value === this.outletId())
      ? [
          {
            key: this.identity() + this.outletId() + this.sessionId(),
            ctx: {
              org: this.auth.effectiveOrgId()!,
              user: this.auth.currentUserId()!,
              revision: this.auth.contextRevision(),
              outlet: this.outletId(),
              session: this.sessionId(),
            },
          },
        ]
      : [],
  );
  readonly displayName = tableDisplayName;
  constructor() {
    let identity = this.identity();
    effect(() => {
      const next = this.identity();
      if (next !== identity || !this.allowed()) {
        identity = next;
        untracked(() => this.selectOutlet(''));
      }
    });
    effect(() => {
      const rows = this.outletOptions();
      if (!this.outletId() && rows.length === 1 && !this.outlets().next)
        this.outletId.set(rows[0].value);
    });
  }
  selectOutlet(id: string | null) {
    this.outletId.set(id ?? '');
    this.sessionId.set('');
    this.message.set('');
  }
  denyCheckout() {
    this.deniedScope.set(this.identity());
    this.sessionId.set('');
  }
  async recoverAccess() {
    const identity = this.identity();
    await this.state.refresh();
    if (this.identity() === identity) {
      this.selectOutlet('');
      this.deniedScope.set('');
    }
  }
  released() {
    this.sessionId.set('');
    this.message.set(this.t.translate('RESTAURANTS.CHECKOUT.TABLE_CLOSED'));
    this.tableSearch()?.nativeElement.focus({ preventScroll: true });
  }
  money(amount: number, currency: string) {
    return restaurantPrice(amount, currency, this.t.getActiveLang());
  }
}
