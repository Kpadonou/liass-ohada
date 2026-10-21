import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { injectMutation } from '@tanstack/angular-query-experimental';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { GuestQrTokenSchema } from '@liass-ohada/shared/restaurants';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
import { guestStorageKey, readGuest, writeGuest } from '../data-access/restaurant-guest-storage';

@Component({
  selector: 'liass-restaurant-guest',
  host: { class: 'block' },
  imports: [MatButtonModule, TranslocoModule],
  template: ` <main
    class="min-h-dvh bg-app-background px-4 py-8 text-app-text-primary sm:px-6 sm:py-12"
  >
    <section class="mx-auto max-w-lg space-y-6" aria-labelledby="guest-title">
      <p class="text-sm font-semibold text-brand-700 dark:text-brand-300">
        {{ 'RESTAURANTS.GUEST.BRAND' | transloco }}
      </p>
      @if (request.isPending()) {
        <h1 id="guest-title" class="text-2xl font-semibold">
          {{ 'RESTAURANTS.GUEST.LOADING' | transloco }}
        </h1>
        <p role="status" aria-live="polite">{{ 'RESTAURANTS.GUEST.WAIT' | transloco }}</p>
      } @else if (context(); as c) {
        <div class="space-y-2 border-b border-app-border pb-5">
          <p class="break-words text-app-text-secondary">
            {{ c.restaurantName }} · {{ c.outletName }}
          </p>
          <h1 id="guest-title" class="break-words text-3xl font-semibold">{{ c.tableName }}</h1>
        </div>
        <p role="status" aria-live="polite">{{ 'RESTAURANTS.GUEST.' + c.state | transloco }}</p>
        <p class="text-app-text-secondary">{{ 'RESTAURANTS.GUEST.CONTACT' | transloco }}</p>
        @if (c.policy === 'DISABLED') {
          <p>{{ 'RESTAURANTS.GUEST.DISABLED' | transloco }}</p>
        }
        <button mat-stroked-button class="min-h-11" type="button" (click)="load(false)">
          {{ 'RESTAURANTS.GUEST.REFRESH' | transloco }}
        </button>
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
      }
    </section>
  </main>`,
})
export class RestaurantGuestPage {
  private readonly api = inject(RestaurantGuestApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private token = '';
  private revision = 0;
  private alive = true;
  readonly fallback = signal('UNAVAILABLE');
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
      if (!this.alive || revision !== this.revision)
        return { result: { state: 'UNAVAILABLE' as const }, revision };
      const saved = fresh ? undefined : readGuest(key);
      const result = saved ? await this.api.renew(saved.capability) : await this.api.resolve(token);
      if (this.alive && revision === this.revision) {
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
      return { result, revision };
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
      : this.request.data()?.revision === this.revision
        ? this.request.data()!.result.state
        : this.fallback(),
  );
  readonly context = computed(() => {
    const value = this.request.data();
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
