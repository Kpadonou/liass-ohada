import { Component, computed, effect, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import type { Outlet } from '@liass-ohada/shared/restaurants';
import { RestaurantsQueries } from '../data-access/restaurants.queries';

/** Domain-owned reference hydration; unknown labels never fall back to opaque IDs. */
@Component({
  selector: 'liass-staff-outlet',
  host: { class: 'block min-w-0' },
  imports: [TranslocoModule, ReactiveFormsModule, MatCheckboxModule],
  template: `
    @if (control(); as checkbox) {
      <mat-checkbox class="w-full" [formControl]="checkbox">
        <span class="break-words">{{ name() }}</span>
        @if (outlet() && !outlet()!.isActive) {
          <span class="text-app-text-secondary">
            · {{ 'RESTAURANTS.TEAM.INACTIVE_OUTLET' | transloco }}</span
          >
        }
      </mat-checkbox>
    } @else {
      <span
        class="inline-flex flex-wrap gap-x-1 rounded-app-control bg-app-surface-muted px-2.5 py-1 text-sm text-app-text-secondary"
      >
        <span class="break-words">{{ name() }}</span>
        @if (outlet() && !outlet()!.isActive) {
          <span>· {{ 'RESTAURANTS.TEAM.INACTIVE_OUTLET' | transloco }}</span>
        }
        @if (inactiveAssignment()) {
          <span>· {{ 'RESTAURANTS.TEAM.PAST_ASSIGNMENT' | transloco }}</span>
        }
      </span>
    }
  `,
})
export class StaffOutletComponent {
  readonly outletId = input.required<string>();
  readonly known = input<Outlet>();
  readonly control = input<FormControl<boolean>>();
  readonly wasAssigned = input(false);
  readonly allowNew = input(true);
  readonly locked = input(false);
  readonly inactiveAssignment = input(false);
  private readonly queries = inject(RestaurantsQueries);
  readonly detail = injectQuery(() => ({
    ...this.queries.detail('outlet', {}, this.outletId(), !this.known()),
    staleTime: 300_000,
  }));
  readonly outlet = computed(() => this.known() ?? this.detail.data() ?? undefined);
  // Transloco is applied here too so hydrated and unavailable references remain readable.
  private readonly t = inject(TranslocoService);
  readonly name = computed(
    () =>
      this.outlet()?.name ??
      this.t.translate(
        this.detail.isPending()
          ? 'RESTAURANTS.TEAM.OUTLET_LOADING'
          : 'RESTAURANTS.TEAM.OUTLET_UNAVAILABLE',
      ),
  );
  constructor() {
    effect(() => {
      const control = this.control();
      if (!control) return;
      const disabled =
        this.locked() ||
        !this.outlet() ||
        (!this.wasAssigned() && (!this.outlet()!.isActive || !this.allowNew()));
      if (disabled) control.disable({ emitEvent: false });
      else control.enable({ emitEvent: false });
    });
  }
}
