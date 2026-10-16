import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';
import type {
  RestaurantServiceFloorResponse,
  ReplaceGuestSessionResponsibleStaffRequestSchema,
} from '@liass-ohada/shared/restaurants';
import type { z } from 'zod';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { staffError } from '../utils/staff-errors';

type Request = z.infer<typeof ReplaceGuestSessionResponsibleStaffRequestSchema>;
export type OccupiedFloorTable = Extract<
  RestaurantServiceFloorResponse['items'][number],
  { state: 'OCCUPIED' }
>;
/** Local command intent only, retained by the originating page across ambiguous dialog retries. */
export interface ResponsibilityIntent {
  current?: Request;
}
export interface ResponsibleStaffDialogData {
  org: string;
  outletId: string;
  table: OccupiedFloorTable;
  clear: boolean;
  intent: ResponsibilityIntent;
  isCurrent: () => boolean;
  canAssign: () => boolean;
}
@Component({
  selector: 'liass-responsible-staff-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    TranslocoModule,
    LiassButtonComponent,
    LiassSearchableSelectComponent,
  ],
  templateUrl: './responsible-staff-dialog.component.html',
})
export class ResponsibleStaffDialogComponent {
  readonly data = inject<ResponsibleStaffDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ResponsibleStaffDialogComponent>);
  private readonly api = inject(RestaurantsApi);
  readonly queries = inject(RestaurantsQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly originalUser = this.queries.userScope();
  private readonly access = inject(ProductAccessState);
  private readonly t = inject(TranslocoService);
  private readonly notification = inject(NotificationService);
  readonly forbidden = signal(false);
  readonly allowed = computed(
    () =>
      this.queries.scope() === this.data.org &&
      this.queries.userScope() === this.originalUser &&
      this.data.isCurrent() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.caps.canManageResponsibility() &&
      !this.forbidden(),
  );
  readonly session = injectQuery(() =>
    this.queries.guestSession(this.data.outletId, this.data.table.guestSessionId, this.allowed()),
  );
  readonly candidates = injectInfiniteQuery(() =>
    this.queries.outletStaff(
      this.data.outletId,
      this.allowed() && !this.data.clear && this.data.canAssign(),
    ),
  );
  readonly options = computed(() => {
    if (!this.data.canAssign()) return [];
    const people = new Map(
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
        .map(({ staff }) => [staff.userId, staff]),
    );
    return [...people.values()].map((staff) => ({
      value: staff.userId,
      label: `${staff.displayName ?? this.t.translate('RESTAURANTS.TEAM.UNNAMED')} · ${this.t.translate('RESTAURANTS.TEAM.ROLES.' + staff.restaurantRole)}`,
    }));
  });
  readonly selection = new FormControl<string | null>(null, Validators.required);
  readonly selected = toSignal(this.selection.valueChanges, { initialValue: null });
  readonly pending = signal(false);
  readonly ambiguous = signal(!!this.data.intent.current);
  readonly error = signal<string | null>(null);
  readonly currentName = computed(() => {
    const session = this.session.data();
    return (
      (session
        ? session.responsibleStaff?.displayName
        : this.data.table.responsibleStaff?.displayName) ??
      this.t.translate('RESTAURANTS.TEAM.UNNAMED')
    );
  });
  readonly assigned = computed(() => !!this.session.data()?.responsibleStaff);
  readonly contextMatches = computed(
    () =>
      this.session.data()?.tableId === this.data.table.tableId &&
      this.session.data()?.status === 'OPEN',
  );
  readonly canSubmit = computed(
    () =>
      this.allowed() &&
      !this.pending() &&
      this.session.isSuccess() &&
      !this.session.isFetching() &&
      this.contextMatches() &&
      (this.ambiguous() ||
        (this.data.clear
          ? this.assigned()
          : this.options().some((option) => option.value === this.selected()) &&
            this.selected() !== this.session.data()?.responsibleStaff?.staffId)),
  );
  constructor() {
    if (this.data.intent.current) this.selection.setValue(this.data.intent.current.staffId);
    effect(() => {
      this.ref.disableClose = this.pending();
      if (this.queries.scope() !== this.data.org || !this.data.isCurrent()) this.ref.close();
      if (this.pending() || this.ambiguous() || !this.allowed() || !this.data.canAssign())
        this.selection.disable({ emitEvent: false });
      else this.selection.enable({ emitEvent: false });
    });
  }
  text(error: unknown) {
    if (error instanceof HttpErrorResponse && error.status === 404)
      return this.t.translate('RESTAURANTS.RESPONSIBILITY.SESSION_UNAVAILABLE');
    return staffError(error, (key) => this.t.translate(key));
  }
  cancel() {
    if (!this.pending()) this.ref.close();
  }
  async refresh() {
    if (this.pending() || !this.allowed()) return;
    await this.queries.responsibilityChanged(
      this.data.org,
      this.data.outletId,
      this.data.table.guestSessionId,
      true,
    );
  }
  async save() {
    if (!this.canSubmit()) return;
    const session = this.session.data();
    if (!session) return;
    const request = this.data.intent.current ?? {
      clientRequestId: crypto.randomUUID(),
      expectedVersion: session.version,
      staffId: this.data.clear ? null : this.selected(),
    };
    if (!this.data.clear && request.staffId === null && !this.ambiguous()) return;
    this.data.intent.current = request;
    this.pending.set(true);
    this.error.set(null);
    try {
      const result = await this.api.replaceResponsibleStaff(
        this.data.org,
        this.data.outletId,
        this.data.table.guestSessionId,
        request,
      );
      this.data.intent.current = undefined;
      this.ambiguous.set(false);
      await this.queries.responsibilityChanged(
        this.data.org,
        this.data.outletId,
        this.data.table.guestSessionId,
      );
      if (this.allowed()) {
        this.notification.success(
          result.message ?? this.t.translate('RESTAURANTS.RESPONSIBILITY.SAVED'),
        );
        this.ref.close(true);
      }
    } catch (error) {
      const definitive =
        error instanceof HttpErrorResponse && [400, 401, 403, 404, 409].includes(error.status);
      if (definitive) {
        this.data.intent.current = undefined;
        this.ambiguous.set(false);
        this.selection.reset(null);
      } else this.ambiguous.set(true);
      if (this.allowed())
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 409
            ? this.t.translate('RESTAURANTS.RESPONSIBILITY.CONFLICT')
            : this.text(error),
        );
      if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
        this.forbidden.set(true);
      await this.queries.responsibilityChanged(
        this.data.org,
        this.data.outletId,
        this.data.table.guestSessionId,
        true,
      );
      if (this.forbidden()) await this.queries.denied(this.data.org);
    } finally {
      this.pending.set(false);
    }
  }
}
