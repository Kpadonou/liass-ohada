import { Component, computed, inject, ElementRef, DestroyRef } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import type { OrganizationMemberSummary } from '@liass-ohada/shared/shared';
import { AuthStore } from '../../identity/data-access/auth.store';
import { OrganizationMembersQueries } from '../../identity/data-access/organization-members.queries';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { AddStaffDialogComponent } from './add-staff-dialog.component';
import { staffError } from '../utils/staff-errors';

/** Absence is derived only from a complete, successful unfiltered Staff collection.
 * Every extra page requires an explicit user action; selected members are checked again by STAFF-2B.
 */
@Component({
  selector: 'liass-available-organization-members',
  host: { class: 'block' },
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    TranslocoModule,
  ],
  templateUrl: './available-organization-members.component.html',
  styleUrl: './restaurant-team.page.css',
})
export class AvailableOrganizationMembersComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroy = inject(DestroyRef);
  private readonly auth = inject(AuthStore);
  private readonly queries = inject(RestaurantsQueries);
  private readonly memberQueries = inject(OrganizationMembersQueries);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly dialog = inject(MatDialog);
  private readonly t = inject(TranslocoService);
  readonly allowed = computed(
    () => this.caps.canProvisionStaff() && this.access.availability('RESTAURANTS') === 'AVAILABLE',
  );
  readonly directory = injectInfiniteQuery(() => this.memberQueries.members(this.allowed()));
  readonly staff = injectInfiniteQuery(() => this.queries.staff(this.allowed()));
  readonly complete = computed(
    () =>
      this.allowed() &&
      this.staff.isSuccess() &&
      !this.staff.isFetching() &&
      !this.staff.hasNextPage(),
  );
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly search = toSignal(this.searchControl.valueChanges, { initialValue: '' });
  readonly candidates = computed(() => {
    if (!this.complete() || this.directory.isError()) return [];
    const existing = new Set(
      this.staff.data()!.pages.flatMap((page) => page.items.map((row) => row.userId)),
    );
    const owner = this.queries.userScope();
    const needle = normalize(this.search());
    return [
      ...new Map(
        (this.directory.data()?.pages.flatMap((page) => page.items) ?? [])
          .filter(
            (row) =>
              row.status === 'ACTIVE' &&
              row.userId !== owner &&
              !existing.has(row.userId) &&
              !!(row.displayName || row.email),
          )
          .filter((row) =>
            normalize(`${row.displayName ?? ''} ${row.email ?? ''}`).includes(needle),
          )
          .map((row) => [row.userId, row]),
      ).values(),
    ];
  });
  readonly columns = ['member', 'actions'];
  error(error: unknown) {
    return staffError(error, (key) => this.t.translate(key));
  }
  configure(member: OrganizationMemberSummary) {
    if (!this.allowed() || !this.candidates().some((row) => row.userId === member.userId)) return;
    const org = this.queries.scope(),
      user = this.queries.userScope(),
      revision = this.auth.contextRevision?.();
    this.dialog
      .open(AddStaffDialogComponent, {
        width: '600px',
        maxWidth: 'calc(100vw - 24px)',
        autoFocus: 'first-tabbable',
        restoreFocus: false,
        data: { org: this.queries.scope(), user: this.queries.userScope(), member },
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(() => {
        if (
          this.allowed() &&
          this.queries.scope() === org &&
          this.queries.userScope() === user &&
          this.auth.contextRevision?.() === revision
        )
          this.host.nativeElement.querySelector<HTMLInputElement>('input[type=search]')?.focus();
      });
  }
}
function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
