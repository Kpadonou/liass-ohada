import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import {
  injectInfiniteQuery,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import type { OrganizationMemberSummary } from '@liass-ohada/shared/shared';
import { AssignInitialProductRoleBodySchema } from '@liass-ohada/shared/shared';
import type { RestaurantStaff } from '@liass-ohada/shared/restaurants';
import { InviteCompanyMemberDialogComponent } from '../../identity/feature/company-invitations/invite-company-member-dialog.component';
import { OrganizationMembersApi } from '../../identity/data-access/organization-members.api';
import { OrganizationMembersQueries } from '../../identity/data-access/organization-members.queries';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { restaurantKeys, RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { staffError } from '../utils/staff-errors';
import {
  StaffProvisioningIntent,
  StaffProvisioningIssue,
  type InitialStaffRole,
} from '../utils/staff-provisioning';

@Component({
  selector: 'liass-add-staff-dialog',
  providers: [
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
  ],
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatButtonModule,
    MatSelectModule,
    MatCheckboxModule,
    MatInputModule,
    TranslocoModule,
    LiassSearchableSelectComponent,
  ],
  templateUrl: './add-staff-dialog.component.html',
})
export class AddStaffDialogComponent {
  private readonly dialogs = inject(MatDialog);
  invite() {
    if (!this.allowed() || this.pending() || this.started()) return;
    this.dialogs
      .open(InviteCompanyMemberDialogComponent, {
        width: '520px',
        maxWidth: 'calc(100vw - 32px)',
        data: this.data,
      })
      .afterClosed()
      .subscribe(() => {
        if (this.allowed()) void this.directory.refetch();
      });
  }
  readonly data = inject<{ org: string; user: string; member?: OrganizationMemberSummary }>(
    MAT_DIALOG_DATA,
  );
  private readonly ref = inject(MatDialogRef<AddStaffDialogComponent>);
  private readonly api = inject(RestaurantsApi);
  private readonly identity = inject(OrganizationMembersApi);
  readonly membersQueries = inject(OrganizationMembersQueries);
  readonly queries = inject(RestaurantsQueries);
  private readonly client = inject(QueryClient);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly auth = inject(AuthStore);
  private readonly access = inject(ProductAccessState);
  private readonly notifications = inject(NotificationService);
  private readonly t = inject(TranslocoService);
  readonly pending = signal(false);
  readonly started = signal(false);
  readonly denied = signal(false);
  readonly error = signal<string | null>(null);
  readonly issue = signal<string | null>(null);
  readonly form = new FormGroup({
    member: new FormControl<string | null>(this.data.member?.userId ?? null, Validators.required),
    role: new FormControl<InitialStaffRole>('WAITER', {
      nonNullable: true,
      validators: Validators.required,
    }),
    outlets: new FormControl<string[]>([], { nonNullable: true }),
    confirm: new FormControl(false, { nonNullable: true }),
  });
  readonly selected = toSignal(this.form.controls.member.valueChanges, {
    initialValue: this.data.member?.userId ?? null,
  });
  readonly confirmed = toSignal(this.form.controls.confirm.valueChanges, { initialValue: false });
  readonly outletSearch = new FormControl('', { nonNullable: true });
  private readonly outletSearchValue = toSignal(this.outletSearch.valueChanges, {
    initialValue: '',
  });
  readonly roles = AssignInitialProductRoleBodySchema.shape.role.options;
  private readonly revision = this.auth.contextRevision?.();
  readonly allowed = computed(
    () =>
      !this.denied() &&
      this.auth.contextRevision?.() === this.revision &&
      this.queries.scope() === this.data.org &&
      this.auth.currentUserId() === this.data.user &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.caps.canProvisionStaff(),
  );
  readonly directory = injectInfiniteQuery(() => this.membersQueries.members(this.allowed()));
  readonly candidates = computed(() => [
    ...new Map(
      (this.directory.data()?.pages.flatMap((page) => page.items) ?? [])
        .filter((row) => row.status === 'ACTIVE' && !!(row.displayName || row.email))
        .map((row) => [row.userId, row]),
    ).values(),
  ]);
  readonly options = computed(() =>
    this.candidates().map((row) => ({
      value: row.userId,
      label: row.displayName ? row.displayName + (row.email ? ' · ' + row.email : '') : row.email!,
    })),
  );
  readonly member = injectQuery(() =>
    this.queries.staffCandidate(this.selected() ?? '', this.allowed() && !!this.selected()),
  );
  readonly assignments = injectInfiniteQuery(() =>
    this.queries.staffOutlets(this.selected() ?? '', this.allowed() && !!this.member.data()),
  );
  readonly locations = injectInfiniteQuery(() => this.queries.list('outlet', {}, this.allowed()));
  readonly outlets = computed(
    () =>
      this.locations
        .data()
        ?.pages.flatMap((page) => page.items)
        .filter((row) => row.isActive) ?? [],
  );
  readonly visibleOutlets = computed(() =>
    this.outlets().filter(
      (row) =>
        row.name
          .toLocaleLowerCase()
          .includes(this.outletSearchValue().trim().toLocaleLowerCase()) ||
        this.form.controls.outlets.value.includes(row.id),
    ),
  );
  readonly inactive = computed(() => this.member.data()?.status === 'INACTIVE');
  readonly existing = computed(() => this.member.data()?.status === 'ACTIVE' && !this.started());
  readonly completeAssignments = computed(
    () =>
      !this.member.data() ||
      (this.assignments.isSuccess() &&
        !this.assignments.hasNextPage() &&
        !this.assignments.isFetching()),
  );
  readonly selectionValid = computed(() =>
    this.candidates().some((row) => row.userId === this.selected()),
  );
  readonly ready = computed(
    () =>
      this.allowed() &&
      !!this.selected() &&
      this.selectionValid() &&
      this.member.isSuccess() &&
      !this.member.isFetching() &&
      !this.existing() &&
      this.locations.isSuccess() &&
      this.completeAssignments() &&
      (!this.inactive() ||
        (this.confirmed() &&
          !!this.member.data()?.restaurantRole &&
          this.member.data()?.organizationMembershipActive)),
  );
  private intent?: StaffProvisioningIntent;
  constructor() {
    effect(() => {
      this.ref.disableClose = this.pending();
      if (
        this.queries.scope() !== this.data.org ||
        this.auth.currentUserId() !== this.data.user ||
        this.auth.contextRevision?.() !== this.revision
      )
        this.ref.close();
    });
    this.form.controls.member.valueChanges.subscribe(() => {
      this.error.set(null);
      this.issue.set(null);
      this.form.controls.confirm.setValue(false);
      this.form.controls.outlets.setValue([]);
    });
  }
  loadError() {
    return staffError(
      this.directory.error() ??
        this.member.error() ??
        this.locations.error() ??
        this.assignments.error(),
      (key) => this.t.translate(key),
    );
  }
  cancel() {
    if (!this.pending()) this.ref.close();
  }
  private check() {
    if (!this.allowed()) throw new HttpErrorResponse({ status: 403 });
  }
  private async canonicalMember() {
    const current = await this.client.fetchQuery({
      ...this.queries.staffCandidate(this.intent!.userId),
      staleTime: 0,
    });
    return current;
  }
  private cache(staff: RestaurantStaff) {
    this.check();
    this.client.setQueryData(restaurantKeys.staffCandidate(this.data.org, staff.userId), staff);
  }
  async review() {
    if (!this.allowed() || this.pending()) return;
    await this.member.refetch();
    await this.assignments.refetch();
    this.intent = undefined;
    this.started.set(false);
    this.issue.set(null);
    this.error.set(null);
    this.form.enable({ emitEvent: false });
    this.form.controls.confirm.setValue(false);
  }
  async submit() {
    if (this.pending() || !this.ready() || this.issue() === 'role') return;
    if (!this.intent) {
      const current = this.member.data();
      this.intent = new StaffProvisioningIntent(
        this.selected()!,
        current?.status === 'INACTIVE' ? current.restaurantRole! : this.form.controls.role.value,
        this.form.controls.outlets.value,
        current?.status === 'INACTIVE' ? current.version : undefined,
      );
    }
    this.started.set(true);
    this.pending.set(true);
    this.error.set(null);
    this.issue.set(null);
    this.form.disable({ emitEvent: false });
    try {
      await this.intent.run({
        check: () => this.check(),
        role: (request) =>
          this.identity.assignInitialRole(
            this.data.org,
            this.data.user,
            this.intent!.userId,
            request,
          ),
        staff: () => this.canonicalMember(),
        bind: async (request) => {
          const result = await this.api.bindStaff(this.data.org, request);
          this.cache(result.data);
          return result.data;
        },
        reactivate: async (request) => {
          const result = await this.api.updateStaff(this.data.org, this.intent!.userId, request);
          this.cache(result.data);
          return result.data;
        },
        assignments: async () => {
          const result = await this.client.fetchInfiniteQuery({
            ...this.queries.staffOutlets(this.intent!.userId),
            staleTime: 0,
          });
          return {
            items: result.pages.flatMap((page) => page.items),
            complete: !result.pages.at(-1)?.nextCursor,
          };
        },
        assign: (id, request) =>
          this.api.staffAssignment(this.data.org, this.intent!.userId, id, true, request),
      });
      this.check();
      this.notifications.success(
        this.t.translate(
          this.intent.activationVersion === undefined
            ? 'RESTAURANTS.TEAM.ADD.SUCCESS'
            : 'RESTAURANTS.TEAM.ADD.REACTIVATED',
        ),
      );
      this.ref.close(true);
    } catch (error) {
      if (error instanceof StaffProvisioningIssue) {
        this.issue.set(error.kind);
        this.error.set(this.t.translate('RESTAURANTS.TEAM.ADD.ERROR_' + error.kind.toUpperCase()));
      } else this.error.set(staffError(error, (key) => this.t.translate(key)));
      if (error instanceof HttpErrorResponse && [401, 403].includes(error.status)) {
        this.denied.set(true);
        await Promise.allSettled([
          this.membersQueries.refresh(this.data.org, this.data.user),
          this.queries.denied(this.data.org),
          this.auth.loadWorkspaces(true),
        ]);
      }
    } finally {
      const user = this.intent.userId;
      await Promise.allSettled([
        this.queries.staffChanged(this.data.org, user),
        this.queries.staffAssignmentsChanged(this.data.org, user, [...this.intent.outlets]),
        this.membersQueries.refresh(this.data.org, this.data.user),
      ]);
      this.pending.set(false);
    }
  }
}
