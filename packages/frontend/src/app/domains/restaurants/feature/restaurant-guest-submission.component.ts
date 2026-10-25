import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule } from '@ngneat/transloco';
import { RestaurantGuestSubmissions } from '../data-access/restaurant-guest-submissions';
@Component({
  selector: 'liass-restaurant-guest-submission',
  imports: [MatButtonModule, TranslocoModule],
  template: ` <section class="space-y-3" aria-live="polite">
    @if (action()) {
      <button
        mat-flat-button
        type="button"
        class="min-h-12 w-full"
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
        <h2 class="font-semibold">{{ 'RESTAURANTS.SUBMISSIONS.TITLE' | transloco }}</h2>
        <button
          mat-button
          [disabled]="workflow.state.isFetching()"
          (click)="workflow.state.refetch()"
        >
          {{ 'RESTAURANTS.SUBMISSIONS.REFRESH' | transloco }}
        </button>
      </div>
      @if (workflow.state.data(); as data) {
        @if (data.state === 'READY') {
          @for (request of data.requests; track request.requestId) {
            <article class="space-y-2 rounded-lg border border-app-border p-3">
              <p class="font-medium">
                {{
                  'RESTAURANTS.SUBMISSIONS.' + (request.orderStatus ?? request.state) | transloco
                }}
              </p>
              <ul>
                @for (line of request.lines; track $index) {
                  <li class="break-words">
                    {{ line.quantity }} × {{ line.name }}
                    @if (line.fulfillment) {
                      <span class="mr-1 text-sm text-app-text-secondary"
                        >· {{ 'RESTAURANTS.SUBMISSIONS.' + line.fulfillment | transloco }}</span
                      >
                    }
                    @if (line.note) {
                      <span class="text-sm text-app-text-secondary">· {{ line.note }}</span>
                    }
                  </li>
                }
              </ul>
              @if (request.reason) {
                <p>{{ request.reason }}</p>
              }
            </article>
          }
        } @else {
          <p>{{ contextKey(data.state) | transloco }}</p>
        }
      }
      @if (workflow.state.isError()) {
        <p role="status">{{ 'RESTAURANTS.SUBMISSIONS.STATUS_ERROR' | transloco }}</p>
      }
    }
  </section>`,
})
export class RestaurantGuestSubmissionComponent {
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
