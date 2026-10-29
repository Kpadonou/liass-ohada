import { RestaurantOutletContext } from '../data-access/restaurant-outlet-context';
import { AvailableOrganizationMembersComponent } from './available-organization-members.component';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from '@angular/material/form-field';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import type { RestaurantStaff } from '@liass-ohada/shared/restaurants';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { LiassPageHeaderComponent } from '../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassSkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { StaffAssignmentsSummaryComponent } from '../ui/staff-assignments-summary.component';
import { MatTableModule } from '@angular/material/table';
import { MatMenuModule } from '@angular/material/menu';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { staffError } from '../utils/staff-errors';
import { StaffAssignmentsDialogComponent } from './staff-assignments-dialog.component';
import { StaffStatusDialogComponent } from './staff-status-dialog.component';
import { AddStaffDialogComponent } from './add-staff-dialog.component';

@Component({
  selector: 'liass-restaurant-team',
  providers: [
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
  ],
  host: { class: 'block' },
  imports: [
    AvailableOrganizationMembersComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    TranslocoModule,
    LiassPageHeaderComponent,
    LiassCardComponent,
    LiassSkeletonComponent,
    StaffAssignmentsSummaryComponent,
    MatTableModule,
    MatMenuModule,
    LiassStatusChipComponent,
  ],
  templateUrl: './restaurant-team.page.html',
  styleUrl: './restaurant-team.page.css',
})
export class RestaurantTeamPage {
  readonly queries = inject(RestaurantsQueries);
  readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly dialog = inject(MatDialog);
  private readonly t = inject(TranslocoService);
  readonly searchFilter = new FormControl('', { nonNullable: true });
  readonly searchValue = toSignal(this.searchFilter.valueChanges, { initialValue: '' });
  readonly search = computed(() => normalizeSearch(this.searchValue()));
  readonly sessionOutlet = inject(RestaurantOutletContext);
  readonly statusFilter = new FormControl<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL', {
    nonNullable: true,
  });

  readonly outletId = computed(() => this.sessionOutlet.id() || null);
  readonly status = toSignal(this.statusFilter.valueChanges, { initialValue: 'ALL' });
  readonly allowed = computed(
    () => this.access.availability('RESTAURANTS') === 'AVAILABLE' && this.caps.canReadStaff(),
  );
  // Organization-wide staff administration manages business records, never Active Outlet.
  readonly team = injectInfiniteQuery(() => this.queries.staff(this.allowed()));
  readonly locations = injectInfiniteQuery(() => this.queries.list('outlet', {}, this.allowed()));
  readonly outlets = computed(
    () => this.locations.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  readonly source = () => ({
    isPending: () => this.team.isPending(),
    error: () => this.team.error(),
    hasNextPage: () => this.team.hasNextPage(),
    isFetchingNextPage: () => this.team.isFetchingNextPage(),
    refetch: () => this.team.refetch(),
    fetchNextPage: () => this.team.fetchNextPage(),
  });
  readonly loaded = computed(() => this.team.data()?.pages.flatMap((page) => page.items) ?? []);
  readonly members = computed(() => [
    ...new Map(
      this.loaded()
        .filter((row) => this.status() === 'ALL' || row.status === this.status())
        .filter(
          (row) => !this.search() || normalizeSearch(row.displayName ?? '').includes(this.search()),
        )
        .map((row) => [row.userId, row]),
    ).values(),
  ]);
  readonly outletsError = computed(() =>
    staffError(this.locations.error(), (key) => this.t.translate(key)),
  );
  readonly error = computed(() =>
    this.source().error()
      ? staffError(this.source().error(), (key) => this.t.translate(key))
      : null,
  );
  readonly denied = computed(
    () =>
      this.source().error() instanceof HttpErrorResponse &&
      [401, 403].includes((this.source().error() as HttpErrorResponse).status),
  );
  constructor() {
    let org = this.queries.scope();
    effect(() => {
      const next = this.queries.scope();
      if (next !== org) {
        org = next;
        this.statusFilter.reset('ALL');
        this.searchFilter.reset('');
      }
    });
  }
  readonly availableExpanded = signal(false);
  readonly columns = ['member', 'role', 'status', 'outlets', 'actions'];
  addMember() {
    if (!this.allowed() || !this.caps.canProvisionStaff()) return;
    this.dialog.open(AddStaffDialogComponent, {
      width: '600px',
      maxWidth: 'calc(100vw - 24px)',
      autoFocus: 'first-tabbable',
      data: { org: this.queries.scope(), user: this.queries.userScope() },
    });
  }
  name(staff: RestaurantStaff) {
    return staff.displayName ?? this.t.translate('RESTAURANTS.TEAM.UNNAMED');
  }
  manageAssignments(staff: RestaurantStaff, returnFocus?: { focus: () => void }) {
    if (!this.allowed() || !this.caps.canManageStaff()) return;
    const org = this.queries.scope();
    this.dialog
      .open(StaffAssignmentsDialogComponent, {
        width: '600px',
        maxWidth: 'calc(100vw - 24px)',
        autoFocus: 'first-tabbable',
        restoreFocus: false,
        data: { org, staff },
      })
      .afterClosed()
      .subscribe(() => {
        if (this.queries.scope() === org) returnFocus?.focus();
      });
  }
  changeStatus(staff: RestaurantStaff, returnFocus?: { focus: () => void }) {
    if (!this.allowed() || !this.caps.canManageStaff()) return;
    const org = this.queries.scope();
    this.dialog
      .open(StaffStatusDialogComponent, {
        width: '520px',
        maxWidth: 'calc(100vw - 24px)',
        // The clicked menu item is removed before this dialog closes.
        restoreFocus: false,
        data: { org, staff },
      })
      .afterClosed()
      .subscribe(() => {
        if (this.queries.scope() === org) returnFocus?.focus();
      });
  }
}

// Same human-text normalization as the approved Accounting Journaux search.
function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
