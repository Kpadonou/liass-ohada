import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  DestroyRef,
  afterNextRender,
  Injector,
} from '@angular/core';
import { GuestIconComponent } from '../ui/guest-icon.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import {
  injectInfiniteQuery,
  InfiniteData,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { GuestCarte, GuestContextResponse } from '@liass-ohada/shared/restaurants';
import {
  GuestCartePage,
  guestCarteKey,
  RestaurantGuestCarteApi,
} from '../data-access/restaurant-guest-carte.queries';
import { writeGuest } from '../data-access/restaurant-guest-storage';
import {
  GuestCartResult,
  RestaurantGuestCartStore,
} from '../data-access/restaurant-guest-cart.store';

type Context = Extract<GuestContextResponse, { state: 'FREE' | 'OCCUPIED' }>;
class GuestContextEnded extends Error {}
@Component({
  selector: 'liass-restaurant-guest-carte',
  host: { class: 'block min-w-0' },
  imports: [
    GuestIconComponent,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TranslocoModule,
  ],
  template: `
    <h2 class="mb-3 text-2xl font-bold">{{ 'RESTAURANTS.GUEST.CARTE.TITLE' | transloco }}</h2>
    @if (query.isPending()) {
      <div role="status" aria-live="polite" class="space-y-4">
        <p class="text-app-text-secondary">{{ 'RESTAURANTS.GUEST.CARTE.LOADING' | transloco }}</p>
        @for (row of [1, 2, 3]; track row) {
          <div
            aria-hidden="true"
            class="h-20 animate-pulse rounded-app-panel bg-app-surface-muted motion-reduce:animate-none"
          ></div>
        }
      </div>
    } @else if (categories().length) {
      @if (query.isError()) {
        <p role="status" class="mb-3 text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.CARTE.STALE' | transloco }}
        </p>
      }
      <nav
        class="sticky top-0 z-10 -mx-4 mb-4 overflow-x-auto bg-app-surface px-4 py-2 sm:bg-app-bg"
        [attr.aria-label]="'RESTAURANTS.GUEST.CARTE.CATEGORIES' | transloco"
      >
        <div class="flex w-max gap-2">
          @for (category of categories(); track category.reference) {
            <button
              mat-button
              type="button"
              class="!min-h-11 whitespace-nowrap !rounded-full !border !border-solid !border-app-border !px-5"
              [class]="
                selected() === category.reference
                  ? '!bg-brand-700 !text-white dark:!bg-brand-300 dark:!text-brand-900'
                  : ''
              "
              [attr.aria-pressed]="selected() === category.reference"
              (click)="select(category.reference)"
            >
              {{ category.name }}
            </button>
          }
        </div>
      </nav>
      <mat-form-field appearance="outline" class="mb-4 w-full" subscriptSizing="dynamic">
        <mat-label>{{ 'RESTAURANTS.GUEST.CARTE.SEARCH' | transloco }}</mat-label>
        <liass-guest-icon matPrefix name="search" class="mx-3 h-5 w-5 text-app-text-secondary" />
        <input
          matInput
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          [value]="searchText()"
          (input)="onSearch($event)"
        />
      </mat-form-field>
      @if (searchText().trim() && query.hasNextPage()) {
        <p role="status" class="mb-3 text-xs text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.CARTE.SEARCH_PARTIAL' | transloco }}
        </p>
      }
      @for (category of visibleCategories(); track category.reference) {
        <section
          class="mb-5 scroll-mt-20"
          [id]="'category-' + category.reference"
          [attr.aria-labelledby]="'heading-' + category.reference"
        >
          <h3
            class="rounded-app-panel bg-app-surface-muted/70 px-3 py-2.5 text-base font-semibold"
            [id]="'heading-' + category.reference"
          >
            {{ category.name }}
          </h3>
          <ul class="grid gap-x-8 md:grid-cols-2">
            @for (item of category.items; track item.reference) {
              <li
                class="flex min-w-0 items-center justify-between gap-3 border-b border-app-border py-3.5"
              >
                <div class="min-w-0">
                  <h4 class="break-words text-base font-semibold leading-snug">{{ item.name }}</h4>
                  <p class="mt-1 text-sm tabular-nums text-app-text-secondary">
                    {{ price(item.amountMinor) }}
                  </p>
                  @if (item.availability === 'UNAVAILABLE') {
                    <p class="mt-1 text-xs font-medium text-app-text-secondary">
                      {{ 'RESTAURANTS.GUEST.CARTE.UNAVAILABLE' | transloco }}
                    </p>
                  }
                </div>
                @if (item.availability !== 'UNAVAILABLE') {
                  <button
                    mat-stroked-button
                    type="button"
                    class="!min-h-11 shrink-0 !px-3"
                    (click)="add(item)"
                    [attr.aria-label]="
                      'RESTAURANTS.GUEST.CART.ADD_LABEL' | transloco: { item: item.name }
                    "
                  >
                    <span class="flex items-center gap-1.5"
                      ><liass-guest-icon name="plus" class="h-4 w-4" />{{
                        'RESTAURANTS.GUEST.CART.ADD' | transloco
                      }}</span
                    >
                  </button>
                }
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p role="status" class="py-5 text-sm text-app-text-secondary">
          {{
            (query.hasNextPage()
              ? 'RESTAURANTS.GUEST.CARTE.SEARCH_PARTIAL_EMPTY'
              : 'RESTAURANTS.GUEST.CARTE.SEARCH_EMPTY'
            ) | transloco
          }}
        </p>
      }
    } @else if (query.isError()) {
      <div role="alert" class="rounded-app-panel bg-app-surface-muted p-5">
        <h3 class="font-semibold">{{ 'RESTAURANTS.GUEST.CARTE.ERROR' | transloco }}</h3>
        <p class="mt-2 text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.CARTE.ERROR_HELP' | transloco }}
        </p>
      </div>
    } @else if (query.hasNextPage()) {
      <p role="status" class="text-app-text-secondary">
        {{ 'RESTAURANTS.GUEST.CARTE.CONTINUE' | transloco }}
      </p>
    } @else {
      <div role="status" class="rounded-app-panel bg-app-surface-muted p-5">
        <h3 class="font-semibold">{{ 'RESTAURANTS.GUEST.CARTE.EMPTY' | transloco }}</h3>
        <p class="mt-2 text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.CARTE.EMPTY_HELP' | transloco }}
        </p>
      </div>
    }
    @if (query.hasNextPage()) {
      <button
        mat-stroked-button
        class="!min-h-11"
        [disabled]="query.isFetching()"
        (click)="query.fetchNextPage()"
      >
        {{ 'RESTAURANTS.GUEST.CARTE.MORE' | transloco }}
      </button>
    }
    @if (cartMessage()) {
      <p role="status" aria-live="polite" class="mt-3 text-sm text-app-text-secondary">
        {{ 'RESTAURANTS.GUEST.CART.ERRORS.' + cartMessage() | transloco }}
      </p>
    }
  `,
})
export class RestaurantGuestCarteComponent {
  readonly context = input.required<Context>();
  readonly scope = input.required<string>();
  readonly ended = output<'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE'>();
  readonly selected = signal('');
  readonly searchText = signal('');
  readonly cartMessage = signal<GuestCartResult | ''>('');
  private readonly api = inject(RestaurantGuestCarteApi);
  private readonly cart = inject(RestaurantGuestCartStore);
  private readonly client = inject(QueryClient);
  private readonly translation = inject(TranslocoService);
  private readonly destroy = inject(DestroyRef);
  private stoppedContext = '';
  private readonly injector = inject(Injector);
  readonly language = () => this.translation.getActiveLang() || 'fr';
  readonly query = injectInfiniteQuery(() => {
    const original = this.context(),
      scope = this.scope();
    const contextKey = scope + ':' + original.guestHandle;
    const current = () =>
      !this.destroy.destroyed &&
      scope === this.scope() &&
      original.guestHandle === this.context().guestHandle;
    return {
      queryKey: guestCarteKey(scope, original.guestHandle),
      initialPageParam: undefined as string | undefined,
      staleTime: 60_000,
      gcTime: 0,
      retry: false,
      refetchOnWindowFocus: true,
      queryFn: async ({ pageParam, queryKey }) => {
        const terminal = (state: 'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE'): never => {
          if (current() && this.stoppedContext !== contextKey) {
            this.stoppedContext = contextKey;
            writeGuest(scope, undefined);
            this.ended.emit(state);
          }
          throw new GuestContextEnded();
        };
        if (!current() || this.stoppedContext === contextKey) throw new GuestContextEnded();
        const cached =
          this.client.getQueryData<InfiniteData<GuestCartePage, string | undefined>>(queryKey);
        const index = cached?.pageParams.findIndex((p) => p === pageParam) ?? -1;
        const result = await this.api.read(
          // The API owns bounded renew/re-resolve recovery, including on first load.
          original.capability,
          pageParam,
          index >= 0 ? cached?.pages[index] : undefined,
        );
        if (!current()) throw new GuestContextEnded();
        if (['EXPIRED', 'VISIT_ENDED', 'UNAVAILABLE'].includes(result.body.state))
          return terminal(result.body.state as 'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE');
        return result;
      },
      getNextPageParam: (page: GuestCartePage) =>
        page.body.state === 'READY' ? page.body.nextCursor : undefined,
    };
  });
  readonly categories = computed(() => {
    const groups = new Map<string, GuestCarte['categories'][number]>();
    for (const page of this.query.data()?.pages ?? [])
      if (page.body.state === 'READY')
        for (const c of page.body.categories) {
          const prior = groups.get(c.reference);
          groups.set(c.reference, {
            ...c,
            items: [
              ...new Map(
                [...(prior?.items ?? []), ...c.items].map((i) => [i.reference, i]),
              ).values(),
            ].sort((a, b) => a.name.localeCompare(b.name)),
          });
        }
    return [...groups.values()].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
  });
  // Presentation-only projections; TanStack Query remains the canonical Carte owner.
  readonly visibleCategories = computed(() => {
    const search = normalizeSearch(this.searchText());
    return search
      ? this.categories()
          .map((category) => ({
            ...category,
            items: category.items.filter((item) => normalizeSearch(item.name).includes(search)),
          }))
          .filter((category) => category.items.length > 0)
      : this.categories();
  });
  readonly currency = computed(
    () =>
      this.query
        .data()
        ?.pages.flatMap((p) => (p.body.state === 'READY' ? [p.body.currency] : []))[0] ?? 'XOF',
  );
  readonly referencesExpireAt = computed(
    () =>
      this.query
        .data()
        ?.pages.flatMap((p) => (p.body.state === 'READY' ? [p.body.referencesExpireAt] : []))[0] ??
      '',
  );
  constructor() {
    effect(() => {
      this.cart.activate(this.scope(), this.context());
      const categories = this.categories();
      if (!this.selected() && categories[0]) this.selected.set(categories[0].reference);
      const items = categories.flatMap((category) => category.items);
      const expiresAt = this.referencesExpireAt();
      if (items.length && expiresAt) this.cart.reconcile(items, this.currency(), expiresAt);
    });
  }
  add(item: GuestCarte['categories'][number]['items'][number]) {
    const result = this.cart.add(item, this.currency(), this.referencesExpireAt());
    this.cartMessage.set(result === 'OK' ? '' : result);
  }
  price(amount: number) {
    const digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: this.currency(),
      }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(this.language(), {
      style: 'currency',
      currency: this.currency(),
      currencyDisplay: 'code',
    }).format(amount / 10 ** digits);
  }
  onSearch(event: Event) {
    this.searchText.set((event.target as HTMLInputElement).value);
  }
  select(reference: string) {
    const wasSearching = !!this.searchText().trim();
    this.searchText.set('');
    this.selected.set(reference);
    const scroll = () => {
      if (!this.destroy.destroyed)
        document
          .getElementById('category-' + reference)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (wasSearching) afterNextRender(scroll, { injector: this.injector });
    else scroll();
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
