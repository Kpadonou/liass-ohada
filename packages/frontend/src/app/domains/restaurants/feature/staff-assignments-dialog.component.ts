import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, FormRecord, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import type { RestaurantStaff, RestaurantStaffOutlet } from '@liass-ohada/shared/restaurants';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { StaffOutletComponent } from '../ui/staff-outlet.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { StaffAssignmentPlan } from '../utils/staff-assignment-plan';
import { staffError } from '../utils/staff-errors';

export interface StaffDialogData {
  org: string;
  staff: RestaurantStaff;
}
@Component({
  selector: 'liass-staff-assignments-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    TranslocoModule,
    StaffOutletComponent,
    LiassSkeletonComponent,
  ],
  templateUrl: './staff-assignments-dialog.component.html',
})
export class StaffAssignmentsDialogComponent {
  readonly data = inject<StaffDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<StaffAssignmentsDialogComponent>);
  private readonly api = inject(RestaurantsApi);
  readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly notifications = inject(NotificationService);
  private readonly t = inject(TranslocoService);
  readonly pending = signal(false);
  readonly locked = signal(false);
  readonly stale = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = new FormRecord<FormControl<boolean>>({});
  readonly allowed = computed(
    () =>
      this.queries.scope() === this.data.org &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.caps.canManageStaff(),
  );
  readonly member = injectQuery(() => ({
    ...this.queries.staffMember(this.data.staff.userId, this.allowed()),
    staleTime: 0,
    refetchOnMount: 'always' as const,
  }));
  readonly assignments = injectInfiniteQuery(() => ({
    ...this.queries.staffOutlets(this.data.staff.userId, this.allowed()),
    staleTime: 0,
    refetchOnMount: 'always' as const,
  }));
  readonly locations = injectInfiniteQuery(() => this.queries.list('outlet', {}, this.allowed()));
  readonly loadError = computed(() =>
    staffError(this.assignments.error() ?? this.member.error() ?? this.locations.error(), (key) =>
      this.t.translate(key),
    ),
  );
  readonly outlets = computed(
    () => this.locations.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly rows = computed(
    () => this.assignments.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly entries = computed(() => [
    ...new Set([
      ...this.outlets().map((outlet) => outlet.id),
      ...this.rows().map((row) => row.outletId),
    ]),
  ]);
  readonly complete = computed(
    () =>
      this.assignments.isSuccess() &&
      !this.assignments.hasNextPage() &&
      !this.assignments.isFetching() &&
      this.member.isSuccess(),
  );
  readonly current = computed(() => this.member.data() ?? this.data.staff);
  readonly name = computed(
    () => this.current().displayName ?? this.t.translate('RESTAURANTS.TEAM.UNNAMED'),
  );
  readonly allowNew = computed(
    () =>
      this.current().status === 'ACTIVE' &&
      this.current().organizationMembershipActive &&
      !!this.current().restaurantRole,
  );
  readonly initialized = signal(false);
  private plan?: StaffAssignmentPlan;
  private baseline: RestaurantStaffOutlet[] = [];
  private snapshot(rows: RestaurantStaffOutlet[]) {
    return JSON.stringify(rows.map((row) => [row.outletId, row.status, row.version]).sort());
  }
  constructor() {
    effect(() => {
      this.ref.disableClose = this.pending();
      if (this.queries.scope() !== this.data.org) this.ref.close();
      if (!this.complete() || this.locked()) return;
      if (!this.initialized()) {
        for (const key of Object.keys(this.form.controls)) this.form.removeControl(key);
        this.baseline = structuredClone(this.rows());
        this.stale.set(false);
        this.initialized.set(true);
      }
      if (this.snapshot(this.rows()) !== this.snapshot(this.baseline)) this.stale.set(true);
      for (const id of this.entries())
        if (!this.form.controls[id])
          this.form.addControl(id, new FormControl(this.wasAssigned(id), { nonNullable: true }));
    });
  }
  control(id: string) {
    return this.form.controls[id];
  }
  known(id: string) {
    return this.outlets().find((outlet) => outlet.id === id);
  }
  wasAssigned(id: string) {
    return this.rows().some((row) => row.outletId === id && row.status === 'ACTIVE');
  }
  cancel() {
    if (!this.pending()) this.ref.close();
  }
  async reload() {
    if (!this.allowed() || this.pending()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      await Promise.all([
        this.assignments.refetch({ throwOnError: true }),
        this.member.refetch({ throwOnError: true }),
      ]);
      this.plan = undefined;
      this.initialized.set(false);
      for (const key of Object.keys(this.form.controls)) this.form.removeControl(key);
      this.locked.set(false);
    } catch (error) {
      this.error.set(staffError(error, (key) => this.t.translate(key)));
    } finally {
      this.pending.set(false);
    }
  }
  async save() {
    if (
      !this.allowed() ||
      this.pending() ||
      !this.complete() ||
      !this.initialized() ||
      this.stale()
    )
      return;
    this.plan ??= new StaffAssignmentPlan(this.baseline, this.form.getRawValue());
    if (!this.plan.commands.length) {
      this.notifications.info(this.t.translate('RESTAURANTS.TEAM.NO_CHANGES'));
      this.ref.close();
      return;
    }
    this.locked.set(true);
    this.pending.set(true);
    this.error.set(null);
    let message: string | null = null;
    try {
      await this.plan.run(async (command) => {
        if (!this.allowed()) throw new Error('Workspace changed');
        const response = await this.api.staffAssignment(
          this.data.org,
          this.data.staff.userId,
          command.outletId,
          command.active,
          command.request,
        );
        message = response.message;
      });
      if (this.allowed()) {
        this.notifications.success(
          message ?? this.t.translate('RESTAURANTS.TEAM.ASSIGNMENTS_SAVED'),
        );
        this.ref.close(true);
      }
    } catch (error) {
      this.error.set(staffError(error, (key) => this.t.translate(key)));
    } finally {
      await this.queries.staffAssignmentsChanged(
        this.data.org,
        this.data.staff.userId,
        this.plan.commands.map((command) => command.outletId),
      );
      this.pending.set(false);
    }
  }
}
