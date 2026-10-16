import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideRouter } from '@angular/router';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AvailableOrganizationMembersComponent } from './available-organization-members.component';
import { AddStaffDialogComponent } from './add-staff-dialog.component';
import { AuthStore } from '../../identity/data-access/auth.store';
import { OrganizationMembersApi } from '../../identity/data-access/organization-members.api';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries } from '../data-access/restaurants.queries';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { staffFixture } from '../data-access/staff.test-fixture';
const org = signal('beta'),
  user = signal('owner'),
  allowed = signal(true);
const member = (userId: string, status = 'ACTIVE') => ({
  userId,
  displayName: userId === 'new' ? 'Sènami A.' : userId,
  status,
});
const directory = { members: vi.fn() },
  api = { staff: vi.fn() };
let client: QueryClient,
  fixture:
    | ReturnType<typeof TestBed.createComponent<AvailableOrganizationMembersComponent>>
    | undefined;
beforeEach(() => {
  org.set('beta');
  user.set('owner');
  allowed.set(true);
  api.staff.mockReset().mockResolvedValue({
    items: [
      staffFixture('active'),
      staffFixture('inactive', { status: 'INACTIVE' }),
      staffFixture('roleless', { restaurantRole: null }),
    ],
  });
  directory.members.mockReset().mockResolvedValue({
    items: ['new', 'owner', 'active', 'inactive', 'roleless']
      .map((id) => member(id))
      .concat([member('suspended', 'SUSPENDED'), member('revoked', 'REVOKED')]),
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: client },
      { provide: AuthStore, useValue: { effectiveOrgId: org, currentUserId: user } },
      { provide: RestaurantsApi, useValue: api },
      { provide: OrganizationMembersApi, useValue: directory },
      { provide: RestaurantsCapabilities, useValue: { canProvisionStaff: allowed } },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
    ],
  });
});
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  client.clear();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
async function page() {
  fixture = TestBed.createComponent(AvailableOrganizationMembersComponent);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(fixture!.componentInstance.directory.isPending()).toBe(false);
    expect(fixture!.componentInstance.staff.isPending()).toBe(false);
  });
  return fixture;
}
it('derives only eligible loaded members, excluding OWNER, active/inactive Staff and suspended/revoked memberships', async () => {
  const f = await page();
  expect(f.componentInstance.candidates().map((row) => row.userId)).toEqual(['new']);
  expect(f.nativeElement.textContent).toContain('Sènami A.');
  expect(f.nativeElement.textContent).not.toContain('En attente');
  expect(f.nativeElement.querySelector('th:last-child')?.textContent).toContain('Actions');
});
it('waits for explicit complete Staff pagination and never fans out member detail requests', async () => {
  api.staff.mockImplementation(async (_org, cursor) =>
    cursor ? { items: [staffFixture('new')] } : { items: [], nextCursor: 'staff-page-2' },
  );
  const f = await page();
  expect(f.componentInstance.candidates()).toEqual([]);
  expect(f.componentInstance.complete()).toBe(false);
  expect(api.staff).toHaveBeenCalledTimes(1);
  expect(f.nativeElement.textContent).toContain('Chargez la suite de l’équipe');
  await f.componentInstance.staff.fetchNextPage();
  f.detectChanges();
  expect(f.componentInstance.candidates().some((row) => row.userId === 'new')).toBe(false);
  expect(api.staff).toHaveBeenCalledTimes(2);
});
it('keeps member pagination explicit, searches loaded names/emails without accents/case, and avoids global totals', async () => {
  directory.members.mockImplementation(async (_org, _user, cursor) =>
    cursor
      ? { items: [{ ...member('second'), email: 'second@example.test' }] }
      : { items: [member('new')], nextCursor: 'directory-2' },
  );
  const f = await page();
  f.componentInstance.searchControl.setValue('SENAMI');
  f.detectChanges();
  expect(f.componentInstance.candidates().length).toBe(1);
  expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS.TEAM.ADD.SEARCH_SCOPE);
  expect(directory.members).toHaveBeenCalledTimes(1);
  await f.componentInstance.directory.fetchNextPage();
  f.componentInstance.searchControl.setValue('SECOND@');
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.candidates().map((row) => row.userId)).toEqual(['second']);
  });
});
it.each(['staff', 'directory'])(
  'keeps %s failure separate from empty/available state',
  async (source) => {
    (source === 'staff' ? api.staff : directory.members).mockRejectedValue(
      new HttpErrorResponse({ status: 403 }),
    );
    const f = await page();
    expect(f.componentInstance.candidates()).toEqual([]);
    expect(f.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(f.nativeElement.textContent).not.toContain(fr.RESTAURANTS.TEAM.AVAILABLE.EMPTY);
  },
);
it('opens the existing canonical dialog with selected member and rechecks eligibility at action time', async () => {
  const f = await page(),
    open = vi
      .spyOn(TestBed.inject(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(true) } as never);
  f.componentInstance.configure(f.componentInstance.candidates()[0]);
  expect(open).toHaveBeenCalledWith(
    AddStaffDialogComponent,
    expect.objectContaining({ data: { org: 'beta', user: 'owner', member: member('new') } }),
  );
  allowed.set(false);
  f.detectChanges();
  f.componentInstance.configure(member('new') as never);
  expect(open).toHaveBeenCalledTimes(1);
});
it('canonical Staff invalidation removes the candidate and refreshes the shared Team collection', async () => {
  const f = await page();
  const rows = [staffFixture('new')];
  api.staff.mockResolvedValue({ items: rows });
  await TestBed.inject(RestaurantsQueries).staffChanged('beta', 'new');
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.staff.data()?.pages[0].items).toEqual(rows);
  });
  expect(f.componentInstance.candidates().some((row) => row.userId === 'new')).toBe(false);
});
it('hides BETA rows immediately on switch, separates late results, and restores BETA canonically', async () => {
  let complete!: (value: unknown) => void;
  directory.members.mockImplementation(async (scope) =>
    scope === 'clo'
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : { items: [member('new')] },
  );
  const f = await page();
  org.set('clo');
  f.detectChanges();
  expect(f.componentInstance.candidates()).toEqual([]);
  await vi.waitFor(() => expect(complete).toBeDefined());
  complete({ items: [member('clo-person')] });
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.candidates()[0]?.userId).toBe('clo-person');
  });
  org.set('beta');
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.candidates()[0]?.userId).toBe('new');
  });
});
it('non-OWNER does not load or expose organization administration after account switch', async () => {
  const f = await page();
  allowed.set(false);
  user.set('waiter');
  f.detectChanges();
  expect(f.componentInstance.candidates()).toEqual([]);
  expect(f.nativeElement.querySelector('table')).toBeNull();
  expect(directory.members).toHaveBeenCalledTimes(1);
});

it('does not mistake an exhausted or partial empty member page for a global count', async () => {
  directory.members.mockResolvedValue({ items: [], nextCursor: 'next' });
  const f = await page();
  expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS.TEAM.AVAILABLE.EMPTY_LOADED);
  expect(f.nativeElement.textContent).not.toContain(fr.RESTAURANTS.TEAM.AVAILABLE.EMPTY);
  directory.members.mockResolvedValue({ items: [] });
  await f.componentInstance.directory.refetch();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(fr.RESTAURANTS.TEAM.AVAILABLE.EMPTY);
  });
});
