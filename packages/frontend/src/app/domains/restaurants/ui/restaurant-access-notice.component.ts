import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';

export type RestaurantAccessNotice =
  | 'configure'
  | 'unsupported'
  | 'changed'
  | 'unverified'
  | 'unassigned';
@Component({
  selector: 'liass-restaurant-access-notice',
  host: { class: 'block' },
  imports: [MatButtonModule, MatIconModule, TranslocoModule, LiassCardComponent],
  template: `
    <section
      class="mx-auto w-full max-w-3xl py-3 sm:py-6"
      [attr.data-access-state]="kind()"
      aria-labelledby="restaurant-access-title"
    >
      <liass-card padding="lg">
        <div class="space-y-5">
          <div
            class="flex size-10 items-center justify-center rounded-app-control bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300"
          >
            <mat-icon aria-hidden="true">{{
              kind() === 'changed' || kind() === 'unverified' ? 'info_outline' : 'restaurant'
            }}</mat-icon>
          </div>
          <div
            class="space-y-2"
            [attr.role]="kind() === 'changed' || kind() === 'unverified' ? 'alert' : null"
          >
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-app-text-secondary">
              {{ 'RESTAURANTS.PAGE.TITLE' | transloco }}
            </p>
            @if (secondaryHeading()) {
              <h2
                id="restaurant-access-title"
                tabindex="-1"
                class="text-lg font-semibold leading-snug text-app-text focus:outline-none md:text-app-page-title"
              >
                {{ prefix() + '.TITLE' | transloco }}
              </h2>
            } @else {
              <h1
                id="restaurant-access-title"
                tabindex="-1"
                class="text-lg font-semibold leading-snug text-app-text focus:outline-none md:text-app-page-title"
              >
                {{ prefix() + '.TITLE' | transloco }}
              </h1>
            }
            <p class="max-w-2xl text-app-body leading-6 text-app-text-secondary">
              {{ prefix() + '.DESCRIPTION' | transloco }}
            </p>
            @if (kind() === 'unsupported') {
              <p class="text-sm font-medium text-app-text-secondary">
                {{ 'RESTAURANTS.ACCESS_LIFECYCLE.YOUR_ROLE' | transloco }}
                {{ 'RESTAURANTS.TEAM.ROLES.' + role() | transloco }}
              </p>
            }
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              mat-flat-button
              type="button"
              class="min-h-11"
              [disabled]="busy()"
              (click)="refresh.emit()"
            >
              <mat-icon aria-hidden="true">refresh</mat-icon
              >{{
                (busy() ? 'RESTAURANTS.ACCESS.CHECKING' : 'RESTAURANTS.ACCESS_LIFECYCLE.REFRESH')
                  | transloco
              }}
            </button>
            <button
              mat-stroked-button
              type="button"
              class="min-h-11"
              [disabled]="busy()"
              (click)="changeWorkspace.emit()"
            >
              <mat-icon aria-hidden="true">swap_horiz</mat-icon
              >{{ 'RESTAURANTS.ACCESS_LIFECYCLE.CHANGE_WORKSPACE' | transloco }}
            </button>
          </div>
          @if (failed()) {
            <p role="alert" class="text-sm text-app-text-secondary">
              {{ 'RESTAURANTS.ACCESS_LIFECYCLE.REFRESH_FAILED' | transloco }}
            </p>
          }
        </div>
      </liass-card>
    </section>
  `,
})
export class RestaurantAccessNoticeComponent {
  readonly kind = input.required<RestaurantAccessNotice>();
  readonly role = input<string>();
  readonly busy = input(false);
  readonly failed = input(false);
  readonly secondaryHeading = input(false);
  readonly refresh = output<void>();
  readonly changeWorkspace = output<void>();
  readonly prefix = computed(() => 'RESTAURANTS.ACCESS_LIFECYCLE.' + this.kind().toUpperCase());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      this.kind();
      queueMicrotask(() => {
        if (!destroy.destroyed)
          this.host.nativeElement.querySelector<HTMLElement>('h1,h2')?.focus();
      });
    });
  }
}
