import { RestaurantGuestSubmissionComponent } from './restaurant-guest-submission.component';
import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { GuestQrTokenSchema } from '@liass-ohada/shared/restaurants';
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
  template: ` <main
    class="min-h-dvh bg-app-background px-4 pb-28 pt-8 text-app-text-primary sm:px-6 sm:pb-28 sm:pt-12"
  >
    <section class="mx-auto max-w-4xl space-y-6" aria-labelledby="guest-title">
      @if (request.isPending()) {
        <h1 id="guest-title" class="text-2xl font-semibold">
          {{ 'RESTAURANTS.GUEST.LOADING' | transloco }}
        </h1>
        <p role="status" aria-live="polite">{{ 'RESTAURANTS.GUEST.WAIT' | transloco }}</p>
      } @else if (context(); as c) {
        <div class="space-y-2 border-b border-app-border pb-5">
          <h1 id="guest-title" class="break-words text-3xl font-semibold tracking-tight">
            {{ c.restaurantName }}
          </h1>
          <p class="break-words text-app-text-secondary">{{ c.outletName }}</p>
          <p class="break-words text-sm text-app-text-secondary">{{ c.tableName }}</p>
        </div>
        <p class="text-sm text-app-text-secondary" role="status" aria-live="polite">
          {{ 'RESTAURANTS.GUEST.' + c.state | transloco }}
        </p>
        <button
          mat-button
          type="button"
          class="min-h-11"
          (click)="refresh()"
          [disabled]="request.isPending()"
        >
          {{ 'RESTAURANTS.GUEST.REFRESH' | transloco }}
        </button>
        @if (c.policy === 'DISABLED') {
          <p class="text-sm text-app-text-secondary">
            {{ 'RESTAURANTS.GUEST.DISABLED' | transloco }}
          </p>
        }
        <liass-restaurant-guest-waiter-call
          [context]="c"
          [scope]="request.data()!.key"
          (ended)="end($event)"
        />
        <liass-restaurant-guest-carte
          [context]="c"
          [scope]="request.data()!.key"
          (ended)="end($event)"
        />
        <liass-restaurant-guest-submission />
        <liass-restaurant-guest-cart [scope]="request.data()!.key" [context]="c" />
      } @else {
        <h1 id="guest-title" class="text-2xl font-semibold">
          {{ 'RESTAURANTS.GUEST.WELCOME' | transloco }}
        </h1>
        <p role="status" aria-live="polite">{{ 'RESTAURANTS.GUEST.' + state() | transloco }}</p>
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
  readonly scope = signal('');
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
      return { result, revision, key };
    },
    retry: false,
    gcTime: 0,
  }));
  readonly state = computed(() =>
    this.request.isError()
      ? this.request.error() instanceof HttpErrorResponse &&
        (this.request.error() as HttpErrorResponse).status === 429
        ? 'RATE_LIMITED'
        : 'NETWORK'
      : this.request.data()?.revision === this.revision &&
          this.api.recovered?.()?.token === this.token
        ? this.api.recovered()!.result.state
        : this.request.data()?.revision === this.revision
          ? this.request.data()!.result.state
          : this.fallback(),
  );
  readonly context = computed(() => {
    const value = this.request.data();
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
    await this.queryClient.invalidateQueries({ queryKey: ['restaurants-guest', 'submissions'] });
    await this.load(false);
  }
  end(state: 'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE') {
    if (state === 'VISIT_ENDED') this.cart.markVisitEnded();
    this.revision++;
    this.request.reset();
    this.fallback.set(state);
  }
  async load(fresh: boolean) {
    this.revision++;
    this.request.reset();
    if (!GuestQrTokenSchema.safeParse(this.token).success) {
      this.fallback.set('UNAVAILABLE');
      return;
    }
    this.request.mutate({ token: this.token, revision: this.revision, fresh });
  }
}
