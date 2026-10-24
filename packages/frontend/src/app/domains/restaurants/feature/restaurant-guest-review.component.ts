import { restaurantOperationalPrice } from '../utils/restaurant-money';
import { NotificationService } from '../../../core/notifications/notification.service';
import { Component, computed, input, inject, signal, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery, injectMutation } from '@tanstack/angular-query-experimental';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
@Component({
  selector: 'liass-restaurant-guest-review',
  imports: [DatePipe, ReactiveFormsModule, MatButtonModule, MatInputModule, TranslocoModule],
  template: ` @if (allowed()) {
    <section
      class="space-y-4 rounded-xl border border-app-border bg-app-surface p-4 sm:p-5"
      [attr.aria-label]="'RESTAURANTS.SUBMISSIONS.REVIEW' | transloco"
    >
      <h2 class="font-semibold">{{ 'RESTAURANTS.SUBMISSIONS.REVIEW' | transloco }}</h2>
      @if (query.isError()) {
        <p role="alert">{{ 'RESTAURANTS.SUBMISSIONS.STATUS_ERROR' | transloco }}</p>
        <button mat-button (click)="query.refetch()">
          {{ 'RESTAURANTS.SUBMISSIONS.REFRESH' | transloco }}
        </button>
      }
      @if (query.data(); as data) {
        @for (request of data.requests; track request.requestId) {
          <article class="space-y-3 border-t border-app-border pt-4">
            <div class="flex flex-wrap justify-between gap-2">
              <p class="font-medium">
                {{ 'RESTAURANTS.SUBMISSIONS.' + request.state | transloco }}
              </p>
              <time class="text-sm text-app-text-secondary">{{
                request.submittedAt | date: 'shortTime'
              }}</time>
            </div>
            <ul class="space-y-2">
              @for (line of request.lines; track $index) {
                <li class="break-words">
                  <span>{{ line.quantity }} × {{ line.name }}</span
                  ><span class="ml-3 text-sm">{{ price(line.amountMinor, line.currency) }}</span>
                  @if (line.note) {
                    <p class="text-sm text-app-text-secondary">{{ line.note }}</p>
                  }
                </li>
              }
            </ul>
            @if (request.reason) {
              <p>{{ request.reason }}</p>
            }
            @if (request.state === 'PENDING_APPROVAL' && allowed()) {
              <div class="flex flex-wrap gap-3">
                <button
                  mat-flat-button
                  [disabled]="mutation.isPending()"
                  (click)="review(request.requestId, 'approve')"
                >
                  {{ 'RESTAURANTS.SUBMISSIONS.ACCEPT' | transloco }}</button
                ><button
                  mat-stroked-button
                  [disabled]="mutation.isPending()"
                  (click)="rejecting.set(request.requestId)"
                >
                  {{ 'RESTAURANTS.SUBMISSIONS.REJECT' | transloco }}
                </button>
              </div>
              @if (rejecting() === request.requestId) {
                <mat-form-field class="w-full"
                  ><mat-label>{{ 'RESTAURANTS.SUBMISSIONS.REASON' | transloco }}</mat-label
                  ><textarea matInput [formControl]="reason" maxlength="250" rows="2"></textarea
                  ><mat-hint>{{ reason.value.length }}/250</mat-hint></mat-form-field
                ><button
                  mat-button
                  [disabled]="reason.invalid || !reason.value.trim() || mutation.isPending()"
                  (click)="review(request.requestId, 'reject')"
                >
                  {{ 'RESTAURANTS.SUBMISSIONS.REJECT' | transloco }}
                </button>
              }
            }
          </article>
        } @empty {
          <p class="text-sm text-app-text-secondary">
            {{ 'RESTAURANTS.SUBMISSIONS.EMPTY' | transloco }}
          </p>
        }
      }
      @if (mutation.isError()) {
        <p role="alert">{{ 'RESTAURANTS.SUBMISSIONS.REVIEW_ERROR' | transloco }}</p>
      }
    </section>
  }`,
})
export class RestaurantGuestReviewComponent {
  private readonly notifications = inject(NotificationService);
  private readonly t = inject(TranslocoService);
  price(amount: number, currency: string) {
    return restaurantOperationalPrice(amount, currency, this.t.getActiveLang() || 'fr');
  }
  readonly outlet = input.required<string>();
  readonly session = input.required<string>();
  readonly active = input(true);
  readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  readonly visible = signal(
    typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  readonly allowed = computed(() => this.active() && this.caps.canReadService());
  readonly query = injectQuery(() =>
    this.queries.guestRequests(this.outlet(), this.session(), this.allowed() && this.visible()),
  );
  readonly rejecting = signal('');
  readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(250)],
  });
  private inFlight = false;
  readonly mutation = injectMutation(() => ({
    mutationFn: (a: {
      outlet: string;
      session: string;
      id: string;
      operation: 'approve' | 'reject';
      reason: string;
    }) => this.queries.reviewGuestRequest(a.outlet, a.session, a.id, a.operation, a.reason),
    retry: false,
    onSettled: () => {
      this.inFlight = false;
    },
    onError: () =>
      this.notifications.error(this.t.translate('RESTAURANTS.SUBMISSIONS.REVIEW_ERROR')),
    onSuccess: (result) => {
      if ('state' in result)
        this.notifications.success(this.t.translate('RESTAURANTS.SUBMISSIONS.' + result.state));
      this.rejecting.set('');
      this.reason.reset();
    },
  }));
  constructor() {
    const listener = () => this.visible.set(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', listener);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', listener));
  }
  review(id: string, operation: 'approve' | 'reject') {
    if (operation === 'reject' && (this.reason.invalid || !this.reason.value.trim())) return;
    if (this.allowed() && !this.inFlight && !this.mutation.isPending()) {
      this.inFlight = true;
      this.mutation.mutate({
        outlet: this.outlet(),
        session: this.session(),
        id,
        operation,
        reason: this.reason.value.trim(),
      });
    }
  }
}
