import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import type { Outlet } from '@liass-ohada/shared/restaurants';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { staffError } from '../utils/staff-errors';
import { StaffOutletComponent } from './staff-outlet.component';

@Component({
  selector: 'liass-staff-assignments-summary',
  host: { class: 'block min-w-0' },
  imports: [MatButtonModule, TranslocoModule, LiassSkeletonComponent, StaffOutletComponent],
  template: ` @if (assignments.isPending()) {
      <div role="status" aria-busy="true">
        <span class="sr-only">{{ 'RESTAURANTS.TEAM.LOADING' | transloco }}</span
        ><liass-skeleton variant="text" />
      </div>
    } @else {
      <div class="flex flex-wrap gap-1.5">
        @for (assignment of visibleRows(); track assignment.outletId) {
          <liass-staff-outlet
            [outletId]="assignment.outletId"
            [known]="known(assignment.outletId)"
            [inactiveAssignment]="assignment.status === 'INACTIVE'"
          />
        }
        @if (rows().length > 2) {
          <button
            mat-button
            type="button"
            [attr.aria-expanded]="expanded()"
            [attr.aria-label]="
              (expanded()
                ? 'RESTAURANTS.TEAM.FEWER_ASSIGNMENTS'
                : 'RESTAURANTS.TEAM.MORE_ASSIGNMENTS'
              ) | transloco
            "
            (click)="expanded.set(!expanded())"
          >
            {{
              expanded()
                ? ('RESTAURANTS.TEAM.FEWER_ASSIGNMENTS' | transloco)
                : ('RESTAURANTS.TEAM.OTHER_ASSIGNMENTS' | transloco: { count: rows().length - 2 })
            }}
          </button>
        }
      </div>
      @if (!rows().length && !assignments.isError()) {
        <p class="text-sm text-app-text-secondary">
          {{ 'RESTAURANTS.TEAM.NO_ASSIGNMENTS' | transloco }}
        </p>
      }
      @if (assignments.isError()) {
        <p role="alert" class="text-sm text-danger-600">{{ assignmentError() }}</p>
        <button mat-button type="button" (click)="assignments.refetch()">
          {{ 'RESTAURANTS.UI.REFRESH' | transloco }}
        </button>
      }
      @if (assignments.hasNextPage()) {
        <button
          mat-button
          type="button"
          [disabled]="assignments.isFetchingNextPage()"
          (click)="assignments.fetchNextPage()"
        >
          {{ 'RESTAURANTS.TEAM.MORE_ASSIGNMENTS' | transloco }}
        </button>
      }
    }`,
})
export class StaffAssignmentsSummaryComponent {
  readonly userId = input.required<string>();
  readonly outlets = input<Outlet[]>([]);
  private readonly queries = inject(RestaurantsQueries);
  private readonly t = inject(TranslocoService);
  readonly assignments = injectInfiniteQuery(() => this.queries.staffOutlets(this.userId()));
  readonly assignmentError = computed(() =>
    staffError(this.assignments.error(), (key) => this.t.translate(key)),
  );
  readonly rows = computed(
    () => this.assignments.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly expanded = signal(false);
  readonly visibleRows = computed(() => (this.expanded() ? this.rows() : this.rows().slice(0, 2)));
  known(id: string) {
    return this.outlets().find((outlet) => outlet.id === id);
  }
}
