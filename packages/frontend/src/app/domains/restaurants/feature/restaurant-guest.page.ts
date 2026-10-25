import { RestaurantGuestSubmissionComponent } from './restaurant-guest-submission.component';
import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { GuestQrTokenSchema, GuestContextResponse } from '@liass-ohada/shared/restaurants';
import { RestaurantGuestWaiterCallComponent } from './restaurant-guest-waiter-call.component';
import { RestaurantGuestCarteComponent } from './restaurant-guest-carte.component';
import { RestaurantGuestCartComponent } from './restaurant-guest-cart.component';
import { RestaurantGuestCartStore } from '../data-access/restaurant-guest-cart.store';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { guestStorageKey, readGuest, writeGuest } from '../data-access/restaurant-guest-storage';

@Component({
  selector: 'liass-restaurant-guest',
  host: { class: 'block' },
  imports: [
    RestaurantGuestSubmissionComponent,
    MatButtonModule,
    TranslocoModule,
    RestaurantGuestCarteComponent,
    RestaurantGuestWaiterCallComponent,
    RestaurantGuestCartComponent,
  ],
  template: ` <main class="min-h-dvh bg-app-bg px-4 pb-32 pt-6 text-app-text sm:px-8 sm:pt-10">
    <section class="mx-auto max-w-[68rem] space-y-10" aria-labelledby="guest-title">
      @if (bootstrapping()) {
        <h1 id="guest-title" class="text-2xl font-semibold">
          {{ 'RESTAURANTS.GUEST.LOADING' | transloco }}
        </h1>
        <p class="mt-3 text-app-text-secondary" role="status" aria-live="polite">
          {{ 'RESTAURANTS.GUEST.WAIT' | transloco }}
        </p>
      } @else if (context(); as c) {
        <header class="space-y-5">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 space-y-2">
              <p class="text-xs font-medium uppercase tracking-widest text-app-text-secondary">
                {{ 'RESTAURANTS.GUEST.WELCOME' | transloco }}
              </p>
              <h1 id="guest-title" class="break-words text-3xl font-semibold sm:text-4xl">
                {{ c.restaurantName }}
              </h1>
              @if (c.outletName !== c.restaurantName) {
                <p class="break-words text-sm text-app-text-secondary">{{ c.outletName }}</p>
              }
            </div>
            <button
              mat-button
              type="button"
              class="!min-h-11 shrink-0 liass-action-neutral"
              (click)="refresh()"
              [disabled]="refreshing()"
              [attr.aria-busy]="refreshing()"
            >
              {{
                (refreshing() ? 'RESTAURANTS.GUEST.REFRESHING' : 'RESTAURANTS.GUEST.REFRESH')
                  | transloco
              }}
            </button>
          </div>
          <div
            class="flex flex-wrap items-center justify-between gap-2 rounded-app-panel bg-app-surface px-4 py-4 sm:px-5"
          >
            <p class="min-w-0 break-words font-semibold">{{ c.tableName }}</p>
            <p class="text-sm text-app-text-secondary" role="status" aria-live="polite">
              {{ 'RESTAURANTS.GUEST.SERVICE_' + c.state | transloco }}
            </p>
          </div>
        </header>
        @if (c.policy === 'DISABLED') {
          <p class="text-sm text-app-text-secondary">
            {{ 'RESTAURANTS.GUEST.DISABLED' | transloco }}
          </p>
        }
        <liass-restaurant-guest-carte [context]="c" [scope]="scope()" (ended)="end($event)" />
        <liass-restaurant-guest-submission />
        <section class="space-y-3 border-t border-app-border pt-6">
          <h2 class="text-base font-semibold">{{ 'RESTAURANTS.GUEST.ASSISTANCE' | transloco }}</h2>
          <liass-restaurant-guest-waiter-call
            [context]="c"
            [scope]="scope()"
            (ended)="end($event)"
          />
        </section>
        <liass-restaurant-guest-cart [scope]="scope()" [context]="c" />
      } @else {
        <h1 id="guest-title" class="text-2xl font-semibold">
          {{ 'RESTAURANTS.GUEST.WELCOME' | transloco }}
        </h1>
        <p class="mt-3 text-app-text-secondary" role="status" aria-live="polite">
          {{ 'RESTAURANTS.GUEST.' + state() | transloco }}
        </p>
        <button
          mat-stroked-button
          class="min-h-11"
          type="button"
          (click)="load(state() === 'EXPIRED' || state() === 'VISIT_ENDED')"
        >
          {{ 'RESTAURANTS.GUEST.RETRY' | transloco }}
        </button>
        @if (scope()) {
          <liass-restaurant-guest-cart [scope]="scope()" [context]="null" />
        }
      }
      <p class="pt-6 text-center text-xs text-app-text-secondary">
        {{ 'RESTAURANTS.GUEST.POWERED_BY' | transloco }}
      </p>
    </section>
  </main>`,
})
export class RestaurantGuestPage {
  private readonly queryClient = inject(QueryClient);
  private readonly api = inject(RestaurantGuestApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private readonly cart = inject(RestaurantGuestCartStore);
  private token = '';
  private revision = 0;
  private alive = true;
  readonly fallback = signal('UNAVAILABLE');
  // Constructor-time mutations can start before TanStack's Angular observer subscribes.
  // Own the bootstrap lifecycle so a missed pending notification cannot show an error.
  readonly bootstrapping = signal(true);
  readonly scope = signal('');
  readonly refreshing = signal(false);
  // Publish the verified entry atomically, independent of mutation-observer timing.
  private readonly resolvedEntry = signal<{
    result: GuestContextResponse;
    revision: number;
    key: string;
  } | null>(null);
  private readonly refreshContext = signal<Extract<
    GuestContextResponse,
    { state: 'FREE' | 'OCCUPIED' }
  > | null>(null);
  readonly request = injectMutation(() => ({
    mutationKey: ['restaurants-guest', 'entry'],
    mutationFn: async ({
      token,
      revision,
      fresh,
    }: {
      token: string;
      revision: number;
      fresh: boolean;
    }) => {
      const key = await guestStorageKey(token);
      if (this.alive && revision === this.revision) this.scope.set(key);
      if (!this.alive || revision !== this.revision)
        return { result: { state: 'UNAVAILABLE' as const }, revision, key };
      const saved = fresh ? undefined : readGuest(key);
      this.api.configureRecovery?.(token, key);
      let result = saved ? await this.api.renew(saved.capability) : await this.api.resolve(token);
      if (saved && (result.state === 'EXPIRED' || result.state === 'UNAVAILABLE'))
        result = await this.api.resolve(token, saved.capability);
      if (this.alive && revision === this.revision) {
        if (result.state === 'VISIT_ENDED') this.cart.markVisitEnded();
        writeGuest(
          key,
          result.state === 'FREE' || result.state === 'OCCUPIED'
            ? {
                guestHandle: result.guestHandle,
                capability: result.capability,
                expiresAt: result.expiresAt,
              }
            : undefined,
        );
      }
      if (this.alive && revision === this.revision)
        this.resolvedEntry.set({ result, revision, key });
      return { result, revision, key };
    },
    retry: false,
    gcTime: 0,
    onSettled: (_data, _error, variables) => {
      if (this.alive && variables.revision === this.revision) this.bootstrapping.set(false);
    },
  }));
  readonly state = computed(() =>
    this.request.isError()
      ? this.request.error() instanceof HttpErrorResponse &&
        (this.request.error() as HttpErrorResponse).status === 429
        ? 'RATE_LIMITED'
        : 'NETWORK'
      : this.resolvedEntry()?.revision === this.revision &&
          this.api.recovered?.()?.token === this.token
        ? this.api.recovered()!.result.state
        : this.resolvedEntry()?.revision === this.revision
          ? this.resolvedEntry()!.result.state
          : this.fallback(),
  );
  readonly context = computed(() => {
    if (this.refreshing() && this.refreshContext()) return this.refreshContext();
    const value = this.resolvedEntry();
    const recovered = this.api.recovered?.();
    if (value?.revision === this.revision && recovered?.token === this.token)
      return recovered.result.state === 'FREE' || recovered.result.state === 'OCCUPIED'
        ? recovered.result
        : null;
    return value?.revision === this.revision &&
      (value.result.state === 'FREE' || value.result.state === 'OCCUPIED')
      ? value.result
      : null;
  });
  constructor() {
    this.destroy.onDestroy(() => {
      this.alive = false;
      this.revision++;
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.token = params.get('opaqueTableToken') ?? '';
      void this.load(false);
    });
  }
  async refresh() {
    if (this.refreshing() || this.bootstrapping()) return;
    this.refreshContext.set(this.context());
    this.refreshing.set(true);
    try {
      await this.load(false, true);
      this.refreshContext.set(null);
      const scope = this.scope();
      await this.queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'restaurants-guest' &&
          ((query.queryKey[1] === 'carte' && query.queryKey[2] === scope) ||
            (query.queryKey[1] === 'submissions' &&
              typeof query.queryKey[2] === 'string' &&
              query.queryKey[2].startsWith(scope + ':'))),
      });
    } finally {
      this.refreshing.set(false);
      this.refreshContext.set(null);
    }
  }

  end(state: 'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE') {
    this.refreshing.set(false);
    this.refreshContext.set(null);
    this.resolvedEntry.set(null);
    if (state === 'VISIT_ENDED') this.cart.markVisitEnded();
    this.revision++;
    this.bootstrapping.set(false);
    this.request.reset();
    this.fallback.set(state);
  }
  async load(fresh: boolean, preserveContent = false) {
    this.revision++;
    if (!preserveContent) {
      this.refreshing.set(false);
      this.refreshContext.set(null);
      this.resolvedEntry.set(null);
      this.bootstrapping.set(true);
      this.request.reset();
    }
    if (!GuestQrTokenSchema.safeParse(this.token).success) {
      this.fallback.set('UNAVAILABLE');
      this.bootstrapping.set(false);
      return;
    }
    try {
      await this.request.mutateAsync({ token: this.token, revision: this.revision, fresh });
    } catch {
      // The mutation exposes the translated terminal state after recovery completes.
    }
  }
}
