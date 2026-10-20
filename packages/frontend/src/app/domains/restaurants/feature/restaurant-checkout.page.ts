import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { ActivatedRoute } from '@angular/router';
import {
  Component,
  Injector,
  afterNextRender,
  DestroyRef,
  computed,
  linkedSignal,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantAccessState } from '../data-access/restaurant-access-state';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { RestaurantCheckoutVisitComponent } from './restaurant-checkout-visit.component';
import { tableDisplayName } from '../utils/table-display-name';
import { restaurantOperationalPrice } from '../utils/restaurant-money';
@Component({
  selector: 'liass-restaurant-checkout',
  host: { class: 'block min-w-0' },
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    TranslocoModule,
    LiassPageHeaderComponent,
    RestaurantCheckoutVisitComponent,
  ],
  styleUrl: './restaurant-checkout.page.scss',
  template: `
    <liass-page-header
      eyebrow=""
      [subtitle]="'RESTAURANTS.CHECKOUT.DESCRIPTION' | transloco"
      [title]="'RESTAURANTS.CHECKOUT.TITLE' | transloco"
    />
    @if (allowed()) {
      @if (outlets().pending) {
        <p role="status">{{ 'RESTAURANTS.CHECKOUT.LOADING' | transloco }}</p>
      }
      @if (outlets().error) {
        <p role="alert">{{ 'RESTAURANTS.CHECKOUT.READ_ERROR' | transloco }}</p>
      }
      @if (outlets().success && !outlets().next && !outletOptions().length) {
        <p>
          {{
            (caps.canManageSetup()
              ? 'RESTAURANTS.CHECKOUT.NO_MANAGEMENT_OUTLETS'
              : 'RESTAURANTS.CHECKOUT.NO_OUTLETS'
            ) | transloco
          }}
        </p>
      }
      @if (outletOptions().length && !outletId()) {
        <p class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.CONTEXT.CHOOSE_HINT' | transloco }}
        </p>
      }
      @if (outletId()) {
        <div
          class="checkout-workspace grid min-w-0 overflow-hidden rounded-app-panel border border-app-border bg-app-surface md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]"
          [class.checkout-show-detail]="sessionId() && detailVisible()"
        >
          <section
            class="checkout-master min-w-0 border-app-border p-4 md:border-r"
            aria-labelledby="checkout-master-heading"
          >
            <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="checkout-master-heading" class="text-base font-semibold">
                {{ 'RESTAURANTS.CHECKOUT.TABLES' | transloco }}
              </h2>
              @if (masterCurrency(); as currency) {
                <span class="text-xs text-app-text-secondary">{{ currency }}</span>
              }
            </div>
            <mat-form-field class="w-full" subscriptSizing="dynamic"
              ><mat-label>{{ 'RESTAURANTS.CHECKOUT.SEARCH' | transloco }}</mat-label
              ><input
                matInput
                type="search"
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
            <div
              class="mt-3 divide-y divide-app-border"
              role="group"
              [attr.aria-label]="'RESTAURANTS.CHECKOUT.SEARCH' | transloco"
            >
              @for (table of occupied(); track table.tableId) {
                <button
                  type="button"
                  mat-button
                  class="checkout-visit-row !grid !grid-cols-[minmax(0,1fr)] w-full !h-auto !justify-start !rounded-none !px-3 !py-3 !text-left"
                  [class.bg-app-surface-selected]="sessionId() === table.guestSessionId"
                  [attr.aria-pressed]="sessionId() === table.guestSessionId"
                  (click)="selectVisit(table.guestSessionId)"
                >
                  <span class="flex w-full min-w-0 items-center gap-2">
                    <mat-icon class="shrink-0" aria-hidden="true">{{
                      sessionId() === table.guestSessionId ? 'check_circle' : 'table_restaurant'
                    }}</mat-icon>
                    <span class="min-w-0 flex-1 break-words font-semibold">{{
                      displayName(table)
                    }}</span>
                    <span class="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">{{
                      money(table.currentAmountMinor, table.currency)
                    }}</span>
                  </span>
                </button>
              }
            </div>
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
          <section
            #detailPanel
            tabindex="-1"
            class="checkout-detail min-w-0 p-4 outline-offset-4 sm:p-5"
            [attr.aria-label]="'RESTAURANTS.CHECKOUT.ADDITION' | transloco"
          >
            @if (sessionId()) {
              <button type="button" mat-button class="!mb-3 md:!hidden" (click)="showTables()">
                <mat-icon>arrow_back</mat-icon>{{ 'RESTAURANTS.CHECKOUT.BACK_TABLES' | transloco }}
              </button>
            }
            @for (context of selectedContext(); track context.key) {
              <liass-checkout-visit
                [ctx]="context.ctx"
                (closed)="released(context.ctx)"
                (accessDenied)="denyCheckout()"
              />
            }
            @if (!sessionId()) {
              <div
                class="flex min-h-64 flex-col items-center justify-center gap-2 px-4 py-8 text-center"
                data-testid="checkout-detail-empty"
              >
                <mat-icon class="text-app-text-secondary" aria-hidden="true"
                  >table_restaurant</mat-icon
                >
                <h2 class="text-base font-semibold">
                  {{ 'RESTAURANTS.CHECKOUT.SELECT_TITLE' | transloco }}
                </h2>
                <p class="max-w-sm text-sm text-app-text-secondary">
                  {{ 'RESTAURANTS.CHECKOUT.SELECT_TABLE' | transloco }}
                </p>
              </div>
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
  readonly operational = inject(RestaurantOutletContext);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly state = inject(RestaurantAccessState);
  private readonly queries = inject(RestaurantsQueries);
  private readonly t = inject(TranslocoService);
  private readonly tableSearch = viewChild<ElementRef<HTMLInputElement>>('tableSearch');
  readonly outletId = this.operational.id;
  readonly sessionId = linkedSignal({
    source: () => [this.identity(), this.outletId()] as const,
    computation: () => '',
  });
  private readonly detailPanel = viewChild<ElementRef<HTMLElement>>('detailPanel');
  private readonly injector = inject(Injector);
  readonly detailVisible = signal(false);
  selectVisit(id: string) {
    this.sessionId.set(id);
    this.detailVisible.set(true);
    afterNextRender(() => this.detailPanel()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }
  showTables() {
    // Presentation only: retain the selected component and any unresolved command intent.
    this.detailVisible.set(false);
    afterNextRender(() => this.tableSearch()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }
  readonly masterCurrency = computed(() => {
    const currencies = new Set(this.occupied().map((row) => row.currency));
    return currencies.size === 1 ? [...currencies][0] : null;
  });
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
  readonly managementOutlets = this.operational.managementQuery;
  readonly selfOutlets = this.operational.selfQuery;
  readonly outlets = computed(() => {
    const q = this.operational.source();
    return {
      pending: q.isPending(),
      error: q.isError(),
      success: q.isSuccess(),
      next: q.hasNextPage(),
      fetch: () => q.fetchNextPage(),
    };
  });
  readonly outletOptions = computed(() =>
    this.operational.outlets().map((row) => ({ value: row.id, label: row.name })),
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
        .filter((page) => page.outletId === this.outletId())
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
    this.operational.use(inject(DestroyRef), inject(ActivatedRoute), () => this.allowed());
    effect(() => {
      if (this.allowed() && this.floorDenied()) untracked(() => this.denyCheckout());
    });
    let outlet = this.outletId();
    effect(() => {
      const next = this.outletId();
      if (next !== outlet) {
        outlet = next;
        this.sessionId.set('');
        this.message.set('');
      }
    });
    let identity = this.identity();
    effect(() => {
      const next = this.identity();
      if (next !== identity || !this.allowed()) {
        identity = next;
        this.sessionId.set('');
      }
    });
  }
  selectOutlet(id: string | null) {
    this.operational.select(id);
    this.sessionId.set('');
    this.message.set('');
  }
  denyCheckout() {
    const outlet = this.outletId();
    this.deniedScope.set(this.identity());
    this.sessionId.set('');
    if (outlet) void this.operational.revoke(outlet);
  }
  async recoverAccess() {
    const identity = this.identity();
    await this.state.refresh();
    if (this.identity() === identity) {
      this.selectOutlet('');
      this.deniedScope.set('');
    }
  }
  released(ctx?: ServiceOrderContext) {
    this.sessionId.set('');
    this.message.set(this.t.translate('RESTAURANTS.CHECKOUT.TABLE_CLOSED'));
    this.tableSearch()?.nativeElement.focus({ preventScroll: true });
    if (ctx)
      void this.router.navigate(
        ['/restaurants/outlets', ctx.outlet, 'sessions', ctx.session, 'receipt'],
        { state: { checkoutClosed: true } },
      );
  }
  money(amount: number, currency: string) {
    return restaurantOperationalPrice(
      amount,
      currency,
      this.t.getActiveLang(),
      this.masterCurrency(),
    );
  }
}
