import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantGuestSubmissions } from '../data-access/restaurant-guest-submissions';
import { DatePipe } from '@angular/common';
@Component({
  selector: 'liass-restaurant-guest-submission',
  host: { class: 'block min-w-0' },
  imports: [DatePipe, MatButtonModule, TranslocoModule],
  template: ` <section class="space-y-4" aria-live="polite">
    @if (action()) {
      <button
        mat-flat-button
        type="button"
        class="!min-h-12 w-full"
        [disabled]="(!workflow.canSend() && !workflow.hasUncertain()) || workflow.send.isPending()"
        (click)="workflow.submit()"
      >
        {{
          (workflow.send.isPending()
            ? 'RESTAURANTS.SUBMISSIONS.SENDING'
            : 'RESTAURANTS.SUBMISSIONS.SEND'
          ) | transloco
        }}
      </button>
      @if (!workflow.canSend() && !workflow.hasUncertain() && !workflow.send.isPending()) {
        <p class="text-sm text-app-text-secondary" role="status">{{ disabledKey() | transloco }}</p>
      } @else if (!workflow.hasUncertain() && !workflow.send.isPending()) {
        <p class="text-sm text-app-text-secondary">
          {{
            (workflow.cart.context()?.policy === 'STAFF_APPROVAL'
              ? 'RESTAURANTS.GUEST.CART.APPROVAL_HELP'
              : 'RESTAURANTS.GUEST.CART.DIRECT_HELP'
            ) | transloco
          }}
        </p>
      }
      @if (workflow.send.isError() || workflow.hasUncertain()) {
        <p role="alert">{{ 'RESTAURANTS.SUBMISSIONS.UNCERTAIN' | transloco }}</p>
        <button mat-stroked-button (click)="workflow.submit()">
          {{ 'RESTAURANTS.SUBMISSIONS.RETRY' | transloco }}
        </button>
      }
      @if (workflow.send.data(); as r) {
        @if (r.identity === workflow.identity() && r.result.state !== 'CONFIRMED') {
          <p role="alert">{{ contextKey(r.result.state) | transloco }}</p>
        }
      }
    }
    @if (!action() && workflow.cart.context()) {
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-2xl font-semibold">{{ 'RESTAURANTS.SUBMISSIONS.TITLE' | transloco }}</h2>
      </div>
      @if (workflow.state.data(); as data) {
        @if (data.state === 'READY') {
          @for (request of orderedRequests(); track request.requestId) {
            <article
              class="max-w-3xl space-y-4 rounded-app-panel bg-app-surface p-5 sm:p-6"
              [class.border-l-2]="!historical(request)"
              [class.border-brand-700]="!historical(request)"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <h3 class="text-sm text-app-text-secondary">
                  {{ 'RESTAURANTS.SUBMISSIONS.ORDER' | transloco }}
                  <time [attr.datetime]="request.submittedAt">{{
                    request.submittedAt | date: 'dd/MM HH:mm'
                  }}</time>
                </h3>
                <p class="font-medium">
                  {{
                    'RESTAURANTS.SUBMISSIONS.' + (request.orderStatus ?? request.state) | transloco
                  }}
                </p>
              </div>
              <ul class="space-y-3">
                @for (line of request.lines; track $index) {
                  <li class="break-words">
                    <p class="font-medium">{{ line.quantity }} × {{ line.name }}</p>
                    @if (line.fulfillment) {
                      <span class="block text-sm text-app-text-secondary">
                        {{
                          'RESTAURANTS.SUBMISSIONS.LINE_STATUS.' + line.fulfillment | transloco
                        }}</span
                      >
                    }
                    @if (line.note) {
                      <span class="block text-sm text-app-text-secondary">{{ line.note }}</span>
                    }
                  </li>
                }
              </ul>
              @if (request.reason) {
                <p>{{ request.reason }}</p>
              }
            </article>
          } @empty {
            <p class="py-4 text-sm text-app-text-secondary">
              {{ 'RESTAURANTS.GUEST.ORDERS_EMPTY' | transloco }}
            </p>
          }
        } @else {
          <p>{{ contextKey(data.state) | transloco }}</p>
        }
      }
      @if (workflow.state.isPending()) {
        <p role="status" class="py-4 text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.ORDERS_LOADING' | transloco }}
        </p>
      }
      @if (workflow.state.isError()) {
        <p role="status">{{ 'RESTAURANTS.SUBMISSIONS.STATUS_ERROR' | transloco }}</p>
      }
    }
  </section>`,
})
export class RestaurantGuestSubmissionComponent {
  historical(request: { state: string; orderStatus?: string }) {
    return (
      ['REJECTED', 'EXPIRED'].includes(request.state) ||
      ['SERVED', 'CANCELLED'].includes(request.orderStatus ?? '')
    );
  }
  orderedRequests() {
    const data = this.workflow.state.data();
    return data?.state === 'READY'
      ? [...data.requests].sort(
          (a, b) =>
            Number(this.historical(a)) - Number(this.historical(b)) ||
            Date.parse(b.submittedAt) - Date.parse(a.submittedAt),
        )
      : [];
  }
  disabledKey() {
    if (this.workflow.cart.context()?.policy === 'DISABLED') return 'RESTAURANTS.GUEST.DISABLED';
    if (
      !this.workflow.cart.context() ||
      !['FREE', 'ACTIVE_VISIT'].includes(this.workflow.cart.contextStatus())
    )
      return 'RESTAURANTS.GUEST.CART.SERVICE_BLOCKED';
    return 'RESTAURANTS.GUEST.CART.REVIEW_HELP';
  }
  contextKey(state: string) {
    return (
      (['EXPIRED', 'VISIT_ENDED', 'UNAVAILABLE'].includes(state)
        ? 'RESTAURANTS.GUEST.'
        : 'RESTAURANTS.SUBMISSIONS.') + state
    );
  }
  readonly action = input(false);
  readonly workflow = inject(RestaurantGuestSubmissions);
}
