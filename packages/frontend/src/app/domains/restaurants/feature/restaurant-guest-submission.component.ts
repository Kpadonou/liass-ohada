import { GuestIconComponent, GuestIconName } from '../ui/guest-icon.component';
import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantGuestSubmissions } from '../data-access/restaurant-guest-submissions';
import { DatePipe } from '@angular/common';
@Component({
  selector: 'liass-restaurant-guest-submission',
  host: { class: 'block min-w-0', '[class.hidden]': 'hiddenEmpty()' },
  imports: [GuestIconComponent, DatePipe, MatButtonModule, TranslocoModule],
  template: ` <section class="space-y-4" aria-live="polite">
    @if (action()) {
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
      <button
        mat-flat-button
        type="button"
        class="!min-h-14 w-full !rounded-app-panel"
        [disabled]="(!workflow.canSend() && !workflow.hasUncertain()) || workflow.send.isPending()"
        (click)="workflow.submit()"
      >
        <span class="flex items-center justify-center gap-3">
          <liass-guest-icon name="send" class="h-5 w-5" />
          {{
            (workflow.send.isPending()
              ? 'RESTAURANTS.SUBMISSIONS.SENDING'
              : 'RESTAURANTS.SUBMISSIONS.SEND'
            ) | transloco
          }}
        </span>
      </button>
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
      @if (!compactEmpty() || orderedRequests().length || workflow.state.isError()) {
        <h2 class="text-2xl font-bold">{{ 'RESTAURANTS.SUBMISSIONS.TITLE' | transloco }}</h2>
      }
      @if (workflow.state.data(); as data) {
        @if (data.state === 'READY') {
          @for (request of orderedRequests(); track request.requestId) {
            <article
              class="max-w-3xl overflow-hidden rounded-app-panel border border-app-border bg-app-surface"
              [class.!border-brand-100]="$first && !historical(request)"
              [attr.data-current]="$first && !historical(request)"
            >
              <div
                class="flex items-center gap-3 bg-app-surface-muted/50 p-4"
                [class.!bg-brand-50]="$first && !historical(request)"
                [class.dark:!bg-brand-900/30]="$first && !historical(request)"
              >
                <div class="min-w-0 flex-1">
                  <h3 class="text-xs text-app-text-secondary">
                    {{ 'RESTAURANTS.GUEST.ORDER' | transloco }} ·
                    <time
                      [attr.datetime]="request.submittedAt"
                      [attr.aria-label]="request.submittedAt | date: 'dd/MM/yyyy HH:mm'"
                      >{{ request.submittedAt | date: 'HH:mm' }}</time
                    >
                  </h3>
                  <p class="mt-1 break-words text-xl font-bold leading-tight">
                    {{ 'RESTAURANTS.GUEST.STATUS.' + statusName(request) | transloco }}
                  </p>
                  <p class="mt-2 text-sm leading-snug text-app-text-secondary">
                    {{ 'RESTAURANTS.GUEST.STATUS_HELP.' + statusName(request) | transloco }}
                  </p>
                </div>
                <span
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-app-surface-selected text-brand-700 dark:text-brand-300"
                  [class.!bg-success-50]="statusIcon(statusName(request)) === 'check'"
                  [class.!text-success-600]="statusIcon(statusName(request)) === 'check'"
                >
                  <liass-guest-icon [name]="statusIcon(statusName(request))" class="h-7 w-7" />
                </span>
              </div>
              <ul class="divide-y divide-app-border px-4">
                @for (line of request.lines; track $index) {
                  <li class="py-3">
                    <div class="flex items-start justify-between gap-3">
                      <p class="min-w-0 flex-1 break-words text-sm font-semibold">
                        {{ line.quantity }} × {{ line.name }}
                      </p>
                      @if (line.fulfillment) {
                        <span class="flex max-w-[48%] items-center gap-1.5 text-xs">
                          <span
                            class="h-2 w-2 shrink-0 rounded-full"
                            [class]="dotClass(line.fulfillment)"
                            aria-hidden="true"
                          ></span>
                          {{ 'RESTAURANTS.GUEST.STATUS.' + line.fulfillment | transloco }}
                        </span>
                      }
                    </div>
                    @if (line.note) {
                      <p class="mt-1 break-words text-xs text-app-text-secondary">
                        {{ line.note }}
                      </p>
                    }
                  </li>
                }
              </ul>
              @if (request.reason) {
                <p class="px-4 pb-4 text-sm text-app-text-secondary">{{ request.reason }}</p>
              }
            </article>
          } @empty {
            @if (!compactEmpty()) {
              <p class="py-2 text-sm text-app-text-secondary">
                {{ 'RESTAURANTS.GUEST.ORDERS_EMPTY' | transloco }}
              </p>
            }
          }
        } @else {
          <p>{{ contextKey(data.state) | transloco }}</p>
        }
      }
      @if (workflow.state.isPending() && !compactEmpty()) {
        <p role="status" class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.GUEST.ORDERS_LOADING' | transloco }}
        </p>
      }
      @if (workflow.state.isError()) {
        <p role="status" class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.SUBMISSIONS.STATUS_ERROR' | transloco }}
        </p>
      }
    }
  </section>`,
})
export class RestaurantGuestSubmissionComponent {
  readonly compactEmpty = input(false);
  hiddenEmpty() {
    const state = this.workflow.state.data();
    return (
      this.compactEmpty() &&
      !this.action() &&
      !this.workflow.state.isError() &&
      (this.workflow.state.isPending() || (state?.state === 'READY' && state.requests.length === 0))
    );
  }
  statusName(request: { state: string; orderStatus?: string }) {
    return request.orderStatus ?? request.state;
  }
  statusIcon(status: string): GuestIconName {
    if (status === 'PREPARING') return 'preparing';
    if (['CONFIRMED', 'ACCEPTED', 'READY', 'SERVED'].includes(status)) return 'check';
    return ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(status) ? 'close' : 'clock';
  }
  dotClass(status: string) {
    if (['REJECTED', 'CANCELLED'].includes(status)) return 'bg-danger-600';
    if (['CONFIRMED', 'ACCEPTED', 'READY', 'SERVED'].includes(status)) return 'bg-success-600';
    return status === 'EXPIRED' ? 'bg-app-text-secondary' : 'bg-warning-600';
  }

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
