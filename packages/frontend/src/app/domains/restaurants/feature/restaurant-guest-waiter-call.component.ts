import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { injectMutation } from '@tanstack/angular-query-experimental';
import type { GuestContextResponse } from '@liass-ohada/shared/restaurants';
import { RestaurantGuestApi } from '../data-access/restaurant-guest.api';
type Context = Extract<GuestContextResponse, { state: 'FREE' | 'OCCUPIED' }>;
@Component({
  selector: 'liass-restaurant-guest-waiter-call',
  host: { class: 'block' },
  imports: [MatButtonModule, TranslocoModule],
  template: ` <section
    class="flex flex-wrap items-center gap-x-4 gap-y-2"
    aria-label="{{ 'RESTAURANTS.WAITER_CALL.ACTION' | transloco }}"
  >
    <button
      mat-stroked-button
      type="button"
      class="min-h-11"
      [disabled]="request.isPending() || waiting()"
      [attr.aria-busy]="request.isPending()"
      (click)="call()"
    >
      {{
        (request.isPending() ? 'RESTAURANTS.WAITER_CALL.PENDING' : 'RESTAURANTS.WAITER_CALL.ACTION')
          | transloco
      }}
    </button>
    <div class="min-w-0 text-sm text-app-text-secondary" role="status" aria-live="polite">
      @if (result(); as r) {
        @if (r.state === 'REQUESTED') {
          <p class="font-medium text-app-text-primary">
            {{ 'RESTAURANTS.WAITER_CALL.REQUESTED' | transloco }}
          </p>
          <p>{{ 'RESTAURANTS.WAITER_CALL.REQUESTED_HELP' | transloco }}</p>
        } @else if (r.state === 'ACKNOWLEDGED') {
          <p>{{ 'RESTAURANTS.WAITER_CALL.ACKNOWLEDGED' | transloco }}</p>
        } @else if (r.state === 'COOLDOWN') {
          <p>{{ 'RESTAURANTS.WAITER_CALL.COOLDOWN' | transloco: { seconds: remaining() } }}</p>
        }
      }
      @if (request.isError()) {
        <p>{{ 'RESTAURANTS.WAITER_CALL.ERROR' | transloco }}</p>
      }
    </div>
  </section>`,
})
export class RestaurantGuestWaiterCallComponent {
  readonly context = input.required<Context>();
  readonly scope = input.required<string>();
  readonly ended = output<'EXPIRED' | 'VISIT_ENDED' | 'UNAVAILABLE'>();
  private readonly api = inject(RestaurantGuestApi);
  private alive = true;
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  readonly now = signal(Date.now());
  private readonly until = signal(0);
  private readonly identity = computed(
    () => this.scope() + ':' + (this.context().visitRef ?? 'FREE'),
  );
  readonly request = injectMutation(() => ({
    mutationKey: ['restaurants-guest', 'waiter-call', this.identity()],
    mutationFn: async (input: { capability: string; identity: string }) => ({
      body: await this.api.waiterCall(input.capability),
      identity: input.identity,
    }),
    retry: false,
    gcTime: 0,
    onSettled: () => {
      this.inFlight = false;
    },
    onSuccess: (result) => {
      if (!this.alive || result.identity !== this.identity()) return;
      const r = result.body;
      if (r.state === 'EXPIRED' || r.state === 'VISIT_ENDED' || r.state === 'UNAVAILABLE') {
        this.ended.emit(r.state);
        return;
      }
      this.now.set(Date.now());
      this.until.set(
        r.state === 'COOLDOWN'
          ? Date.now() + r.retryAfterSeconds * 1000
          : r.state === 'REQUESTED'
            ? Date.parse(r.requestedAt) + 600_000
            : 'acknowledgedAt' in r
              ? Date.parse(r.acknowledgedAt) + 60_000
              : 0,
      );
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.now.set(Date.now());
        if (this.now() >= this.until() && this.timer) {
          clearInterval(this.timer);
          this.timer = undefined;
        }
      }, 1000);
    },
  }));
  readonly result = computed(() =>
    this.request.data()?.identity === this.identity() ? this.request.data()!.body : null,
  );
  readonly waiting = computed(() => !!this.result() && this.until() > this.now());
  readonly remaining = computed(() => Math.max(0, Math.ceil((this.until() - this.now()) / 1000)));
  constructor() {
    effect(() => {
      this.identity();
      this.request.reset();
      this.until.set(0);
      if (this.timer) clearInterval(this.timer);
    });
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
      if (this.timer) clearInterval(this.timer);
    });
  }
  call() {
    if (this.inFlight || this.request.isPending() || this.waiting()) return;
    this.inFlight = true;
    this.request.mutate({ capability: this.context().capability, identity: this.identity() });
  }
}
