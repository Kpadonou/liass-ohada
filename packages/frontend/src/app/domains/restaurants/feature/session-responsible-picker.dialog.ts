import { Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';

@Component({
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    TranslocoModule,
    LiassSearchableSelectComponent,
    LiassButtonComponent,
  ],
  template: `
    <h2 mat-dialog-title>{{ 'RESTAURANTS.RESPONSIBILITY.SELECT' | transloco }}</h2>
    <mat-dialog-content class="space-y-4">
      <liass-searchable-select
        labelKey="RESTAURANTS.RESPONSIBILITY.SELECT"
        icon="person_outline"
        [options]="options()"
        [formControl]="selection"
        [loading]="candidates.isPending() && candidates.isFetching()"
        [showError]="selection.touched && selection.invalid"
        errorKey="RESTAURANTS.RESPONSIBILITY.REQUIRED"
      />
      @if (candidates.isError()) {
        <p role="alert">{{ 'RESTO_SERVICE.STAFF_ERROR' | transloco }}</p>
        <button mat-button (click)="candidates.refetch()">
          {{ 'RESTAURANTS.UI.REFRESH' | transloco }}
        </button>
      }
      @if (candidates.hasNextPage()) {
        <p>{{ 'RESTAURANTS.RESPONSIBILITY.PARTIAL' | transloco }}</p>
        <button
          mat-button
          [disabled]="candidates.isFetchingNextPage()"
          (click)="candidates.fetchNextPage()"
        >
          {{ 'RESTAURANTS.TEAM.MORE_MEMBERS' | transloco }}
        </button>
      }
      @if (!candidates.isPending() && !candidates.isError() && !options().length) {
        <p>{{ 'RESTAURANTS.RESPONSIBILITY.NO_CANDIDATE' | transloco }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close()">{{ 'RESTAURANTS.UI.CANCEL' | transloco }}</button>
      <liass-button (pressed)="choose()">{{ 'RESTO_SERVICE.OPEN' | transloco }}</liass-button>
    </mat-dialog-actions>
  `,
})
export class SessionResponsiblePickerDialog {
  readonly data = inject<{ outletId: string; isCurrent: () => boolean }>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<SessionResponsiblePickerDialog>);
  readonly queries = inject(RestaurantsQueries);
  readonly t = inject(TranslocoService);
  readonly candidates = injectInfiniteQuery(() =>
    this.queries.outletStaff(this.data.outletId, this.data.isCurrent()),
  );
  readonly selection = new FormControl<string | null>(null, Validators.required);
  readonly options = computed(() =>
    (this.candidates.data()?.pages.flatMap((page) => page.items) ?? [])
      .filter(
        ({ staff, assignment }) =>
          assignment.outletId === this.data.outletId &&
          assignment.userId === staff.userId &&
          assignment.status === 'ACTIVE' &&
          staff.status === 'ACTIVE' &&
          staff.organizationMembershipActive &&
          ['OWNER', 'MANAGER', 'WAITER'].includes(staff.restaurantRole ?? ''),
      )
      .map(({ staff }) => ({
        value: staff.userId,
        label: `${staff.displayName ?? this.t.translate('RESTAURANTS.TEAM.UNNAMED')}`,
      })),
  );
  choose() {
    this.selection.markAsTouched();
    if (
      this.data.isCurrent() &&
      !this.candidates.isError() &&
      this.options().some((v) => v.value === this.selection.value)
    )
      this.ref.close(this.selection.value);
  }
}
