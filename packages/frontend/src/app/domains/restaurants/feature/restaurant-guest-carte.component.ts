import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  DestroyRef,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import {
  injectInfiniteQuery,
  InfiniteData,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { GuestCarte, GuestContextResponse } from '@liass-ohada/shared/restaurants';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
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
  imports: [MatButtonModule, TranslocoModule],
  template: `
    <div class="flex items-center justify-between gap-4 pb-5">
      <h2 class="text-3xl font-semibold tracking-tight">
        {{ 'RESTAURANTS.GUEST.CARTE.TITLE' | transloco }}
      </h2>
      <button
        mat-button
        type="button"
        class="min-h-11"
        (click)="query.refetch()"
        [disabled]="query.isFetching()"
      >
        {{ 'RESTAURANTS.GUEST.CARTE.REFRESH' | transloco }}
      </button>
    </div>
    @if (query.isPending()) {
      <div role="status" aria-live="polite" class="space-y-4">
        <p class="text-app-text-secondary">{{ 'RESTAURANTS.GUEST.CARTE.LOADING' | transloco }}</p>
        @for (row of [1, 2, 3]; track row) {
          <div
            aria-hidden="true"
            class="h-24 animate-pulse rounded-xl border border-app-border bg-app-surface"
          ></div>
        }
      </div>
    } @else if (categories().length) {
      @if (query.isError()) {
        <div
          role="status"
          class="mb-3 flex flex-wrap items-center justify-between gap-1 rounded-lg border border-app-border px-3 py-2 text-xs"
        >
          <span>{{ 'RESTAURANTS.GUEST.CARTE.STALE' | transloco }}</span
          ><button mat-button class="!min-h-9" (click)="query.refetch()">
            {{ 'RESTAURANTS.GUEST.RETRY' | transloco }}
          </button>
        </div>
      }
      <nav
        class="sticky top-0 z-10 -mx-4 mb-6 overflow-x-auto border-b border-app-border bg-app-background px-4 py-2"
        [attr.aria-label]="'RESTAURANTS.GUEST.CARTE.CATEGORIES' | transloco"
      >
        <div class="flex w-max gap-2">
          @for (category of categories(); track category.reference) {
            @if (selected() === category.reference) {
              <button
                mat-flat-button
                type="button"
                class="!min-h-11 whitespace-nowrap !rounded-full !px-5"
                aria-pressed="true"
                (click)="select(category.reference)"
              >
                {{ category.name }}
              </button>
            } @else {
              <button
                mat-button
                type="button"
                class="!min-h-11 whitespace-nowrap !rounded-full !px-5"
                aria-pressed="false"
                (click)="select(category.reference)"
              >
                {{ category.name }}
              </button>
            }
          }
        </div>
      </nav>
      @for (category of categories(); track category.reference) {
        <section
          class="mb-8 scroll-mt-24"
          [id]="'category-' + category.reference"
          [attr.aria-labelledby]="'heading-' + category.reference"
        >
          <h2 class="mb-3 text-xl font-semibold" [id]="'heading-' + category.reference">
            {{ category.name }}
          </h2>
          <ul class="grid gap-x-6 sm:grid-cols-2">
            @for (item of category.items; track item.reference) {
              <li class="min-w-0 border-b border-app-border py-6">
                <div class="flex items-start justify-between gap-4">
                  <h3 class="min-w-0 break-words text-base font-medium leading-relaxed">
                    {{ item.name }}
                  </h3>
                  <p class="shrink-0 whitespace-nowrap pt-1 text-base font-semibold tabular-nums">
                    {{ price(item.amountMinor) }}
                  </p>
                </div>
                @if (item.availability === 'UNAVAILABLE') {
                  <p class="mt-2 text-sm font-medium text-app-text-secondary">
                    {{ 'RESTAURANTS.GUEST.CARTE.UNAVAILABLE' | transloco }}
                  </p>
                } @else {
                  <button
                    mat-stroked-button
                    type="button"
                    class="mt-3 min-h-11"
                    (click)="add(item)"
                  >
                    {{ 'RESTAURANTS.GUEST.CART.ADD' | transloco }}
                  </button>
                }
              </li>
            }
          </ul>
        </section>
      }
    } @else if (query.isError()) {
      <div role="alert" class="rounded-xl border border-app-border bg-app-surface p-6">
        <h2 class="text-lg font-semibold">{{ 'RESTAURANTS.GUEST.CARTE.ERROR' | transloco }}</h2>
        <p class="mt-2 text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.CARTE.ERROR_HELP' | transloco }}
        </p>
        <button mat-stroked-button class="mt-4 min-h-11" (click)="query.refetch()">
          {{ 'RESTAURANTS.GUEST.RETRY' | transloco }}
        </button>
      </div>
    } @else if (query.hasNextPage()) {
      <p role="status" class="text-app-text-secondary">
        {{ 'RESTAURANTS.GUEST.CARTE.CONTINUE' | transloco }}
      </p>
    } @else {
      <div role="status" class="rounded-xl border border-app-border bg-app-surface p-6">
        <h2 class="text-lg font-semibold">{{ 'RESTAURANTS.GUEST.CARTE.EMPTY' | transloco }}</h2>
        <p class="mt-2 text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.CARTE.EMPTY_HELP' | transloco }}
        </p>
      </div>
    }
    @if (query.hasNextPage()) {
      <button
        mat-stroked-button
        class="min-h-11"
        [disabled]="query.isFetching()"
        (click)="query.fetchNextPage()"
      >
        {{ 'RESTAURANTS.GUEST.CARTE.MORE' | transloco }}
      </button>
    }
    @if (cartMessage()) {
      <p role="status" aria-live="polite" class="mt-4 text-sm font-medium text-app-text-secondary">
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
  readonly cartMessage = signal<GuestCartResult | ''>('');
  private readonly api = inject(RestaurantGuestCarteApi);
  private readonly guest = inject(RestaurantGuestApi);
  private readonly cart = inject(RestaurantGuestCartStore);
  private readonly client = inject(QueryClient);
  private readonly translation = inject(TranslocoService);
  private readonly destroy = inject(DestroyRef);
  private stoppedContext = '';
  private credentialContext = '';
  private credential: Context | undefined;
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
        let credential =
          this.credential && this.credentialContext === contextKey ? this.credential : original;
        const terminal = (state: 'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE'): never => {
          if (current() && this.stoppedContext !== contextKey) {
            this.stoppedContext = contextKey;
            writeGuest(scope, undefined);
            this.ended.emit(state);
          }
          throw new GuestContextEnded();
        };
        if (!current() || this.stoppedContext === contextKey) throw new GuestContextEnded();
        if (Date.parse(credential.expiresAt) - Date.now() < 60_000) {
          const renewed = await this.guest.renew(credential.capability);
          if (!current()) throw new GuestContextEnded();
          if (renewed.state !== 'FREE' && renewed.state !== 'OCCUPIED')
            return terminal(renewed.state);
          if (renewed.guestHandle !== original.guestHandle || renewed.state !== original.state)
            return terminal('UNAVAILABLE');
          credential = renewed;
          this.credential = renewed;
          this.credentialContext = contextKey;
          writeGuest(scope, {
            guestHandle: renewed.guestHandle,
            capability: renewed.capability,
            expiresAt: renewed.expiresAt,
          });
        }
        const cached =
          this.client.getQueryData<InfiniteData<GuestCartePage, string | undefined>>(queryKey);
        const index = cached?.pageParams.findIndex((p) => p === pageParam) ?? -1;
        const result = await this.api.read(
          credential.capability,
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
  select(reference: string) {
    this.selected.set(reference);
    document
      .getElementById('category-' + reference)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
