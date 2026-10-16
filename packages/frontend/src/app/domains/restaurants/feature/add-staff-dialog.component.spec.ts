import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { provideRouter } from '@angular/router';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AddStaffDialogComponent } from './add-staff-dialog.component';
import { OrganizationMembersApi } from '../../identity/data-access/organization-members.api';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { NotificationService } from '../../../core/notifications/notification.service';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { staffFixture, teamOutlets, assignmentFixture } from '../data-access/staff.test-fixture';
import type { RestaurantStaff } from '@liass-ohada/shared/restaurants';
const org = signal('org'),
  user = signal('owner'),
  permission = signal(true);
const identity = { members: vi.fn(), assignInitialRole: vi.fn() };
const api = {
  staffMember: vi.fn(),
  bindStaff: vi.fn(),
  updateStaff: vi.fn(),
  staffOutlets: vi.fn(),
  staffAssignment: vi.fn(),
  list: vi.fn(),
};
const notification = { success: vi.fn() },
  ref = { close: vi.fn(), disableClose: false },
  refresh = vi.fn();
let current: RestaurantStaff | null, client: QueryClient;
let fixture: ReturnType<typeof TestBed.createComponent<AddStaffDialogComponent>> | undefined;
beforeEach(() => {
  org.set('org');
  user.set('owner');
  permission.set(true);
  current = null;
  for (const mock of [
    ...Object.values(api),
    ...Object.values(identity),
    notification.success,
    ref.close,
    refresh,
  ])
    mock.mockReset();
  identity.members.mockResolvedValue({
    items: [
      {
        userId: 'member',
        displayName: 'Aïssatou S.',
        email: 'aissa@example.test',
        status: 'ACTIVE',
      },
      { userId: 'suspended-id', displayName: 'Suspended', status: 'SUSPENDED' },
    ],
  });
  identity.assignInitialRole.mockResolvedValue({
    userId: 'member',
    role: 'WAITER',
    productCode: 'RESTAURANTS',
  });
  api.staffMember.mockImplementation(async () => {
    if (!current) throw new HttpErrorResponse({ status: 404 });
    return current;
  });
  api.bindStaff.mockImplementation(async () => ({
    data: (current = staffFixture('member')),
    message: null,
  }));
  api.updateStaff.mockImplementation(async () => ({
    data: (current = staffFixture('member', { version: 3 })),
    message: null,
  }));
  api.staffOutlets.mockResolvedValue({ items: [] });
  api.staffAssignment.mockResolvedValue({ data: assignmentFixture(), message: null });
  api.list.mockResolvedValue({ items: teamOutlets });
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
      {
        provide: AuthStore,
        useValue: { effectiveOrgId: org, currentUserId: user, loadWorkspaces: refresh },
      },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      { provide: RestaurantsCapabilities, useValue: { canProvisionStaff: permission } },
      { provide: OrganizationMembersApi, useValue: identity },
      { provide: RestaurantsApi, useValue: api },
      { provide: NotificationService, useValue: notification },
      { provide: MAT_DIALOG_DATA, useValue: { org: 'org', user: 'owner' } },
      { provide: MatDialogRef, useValue: ref },
    ],
  });
});
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  client.clear();
  TestBed.resetTestingModule();
});
async function dialog() {
  fixture = TestBed.createComponent(AddStaffDialogComponent);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture!.detectChanges();
    expect(fixture!.componentInstance.directory.isPending()).toBe(false);
  });
  return fixture;
}
async function select() {
  const f = await dialog();
  f.componentInstance.form.controls.member.setValue('member');
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.member.isSuccess()).toBe(true);
  });
  return f;
}
it('renders safe existing-member selection, exactly four role choices and zero optional outlets', async () => {
  const f = await select();
  expect(f.componentInstance.options()[0].label).toContain('Aïssatou S.');
  expect(f.componentInstance.options().some((row) => row.value === 'suspended-id')).toBe(false);
  expect(f.componentInstance.roles).toEqual(['MANAGER', 'WAITER', 'CASHIER', 'KITCHEN']);
  expect(f.nativeElement.textContent).not.toMatch(/member|suspended-id|Cognito|mot de passe/);
  expect(f.componentInstance.form.controls.outlets.value).toEqual([]);
  await f.componentInstance.submit();
  expect(api.bindStaff).toHaveBeenCalledWith('org', {
    memberUserId: 'member',
    clientRequestId: expect.any(String),
  });
  expect(api.staffAssignment).not.toHaveBeenCalled();
  expect(ref.close).toHaveBeenCalledWith(true);
});
it('blocks duplicate creation for an already ACTIVE Staff', async () => {
  current = staffFixture('member');
  const f = await select();
  expect(f.nativeElement.textContent).toContain('Cette personne fait déjà partie de l’équipe');
  expect(f.componentInstance.ready()).toBe(false);
  await f.componentInstance.submit();
  expect(identity.assignInitialRole).not.toHaveBeenCalled();
});
it('requires explicit reactivation confirmation and uses the canonical version without a role mutation', async () => {
  current = staffFixture('member', { status: 'INACTIVE', version: 2 });
  const f = await select();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.completeAssignments()).toBe(true);
  });
  expect(f.componentInstance.ready()).toBe(false);
  expect(f.nativeElement.textContent).toContain('Je confirme la réactivation');
  f.componentInstance.form.controls.confirm.setValue(true);
  f.detectChanges();
  await f.componentInstance.submit();
  expect(api.updateStaff).toHaveBeenCalledWith('org', 'member', {
    status: 'ACTIVE',
    expectedVersion: 2,
    clientRequestId: expect.any(String),
  });
  expect(identity.assignInitialRole).not.toHaveBeenCalled();
});
it('empty directory pages retain explicit load-more and truthful local search scope', async () => {
  identity.members
    .mockResolvedValueOnce({ items: [], nextCursor: 'opaque-next' })
    .mockResolvedValue({
      items: [{ userId: 'member', email: 'person@example.test', status: 'ACTIVE' }],
    });
  const f = await dialog();
  expect(f.nativeElement.textContent).toContain('Charger plus de membres');
  expect(f.nativeElement.textContent).toContain('La recherche porte sur les membres chargés');
  expect(f.nativeElement.textContent).not.toContain('Aucun autre membre');
  await f.componentInstance.directory.fetchNextPage();
  f.detectChanges();
  expect(identity.members).toHaveBeenLastCalledWith('org', 'owner', 'opaque-next');
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.options()[0]?.label).toBe('person@example.test');
  });
});
it('final empty state differs from a loading failure', async () => {
  identity.members.mockResolvedValue({ items: [] });
  const f = await dialog();
  expect(f.nativeElement.textContent).toContain('Aucun autre membre de l’espace de travail');
});
it('directory failure remains an error rather than an empty directory', async () => {
  identity.members.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
  const f = await dialog();
  expect(f.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  expect(f.nativeElement.textContent).not.toContain('Aucun autre membre');
});
it('different role stops provisioning and displays a business-safe conflict', async () => {
  identity.assignInitialRole.mockRejectedValue(
    new HttpErrorResponse({
      status: 409,
      error: { error: { code: 'PLATFORM_PRODUCT_ROLE_CONFLICT' } },
    }),
  );
  const f = await select();
  await f.componentInstance.submit();
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain(
    'La modification des rôles n’est pas encore disponible',
  );
  expect(f.nativeElement.textContent).not.toContain('PLATFORM_PRODUCT');
  expect(api.bindStaff).not.toHaveBeenCalled();
  expect(ref.close).not.toHaveBeenCalled();
});
it('403 refreshes authority and stops all subsequent Restaurants writes', async () => {
  identity.assignInitialRole.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
  const f = await select();
  await f.componentInstance.submit();
  f.detectChanges();
  expect(f.componentInstance.allowed()).toBe(false);
  expect(refresh).toHaveBeenCalledWith(true);
  expect(api.bindStaff).not.toHaveBeenCalled();
});
it.each(['org', 'user'])(
  'changing %s closes the scoped dialog and prevents submit',
  async (kind) => {
    const f = await select();
    if (kind === 'org') org.set('other');
    else user.set('other');
    f.detectChanges();
    expect(ref.close).toHaveBeenCalled();
    await f.componentInstance.submit();
    expect(api.bindStaff).not.toHaveBeenCalled();
  },
);
it('does not submit duplicates while pending and retains intent for retry', async () => {
  let reject!: (error: unknown) => void;
  identity.assignInitialRole.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const f = await select();
  const first = f.componentInstance.submit();
  await f.componentInstance.submit();
  expect(identity.assignInitialRole).toHaveBeenCalledTimes(1);
  reject(new HttpErrorResponse({ status: 0 }));
  await first;
  const original = identity.assignInitialRole.mock.calls[0][3];
  await f.componentInstance.submit();
  expect(identity.assignInitialRole.mock.calls[1][3]).toEqual(original);
});

it('offers only a secondary Identity invitation to the authorized OWNER alongside existing-member selection', async () => {
  const f = await dialog();
  expect(f.nativeElement.textContent).toContain('Inviter une personne');
  expect(f.componentInstance.form.controls).not.toHaveProperty('email');
  expect(f.componentInstance.form.controls).not.toHaveProperty('password');
});
it.each(['MANAGER', 'WAITER', 'CASHIER', 'KITCHEN'])(
  'does not render an invitation affordance without OWNER provisioning authority (%s)',
  async () => {
    permission.set(false);
    fixture = TestBed.createComponent(AddStaffDialogComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Inviter une personne');
    expect(identity.assignInitialRole).not.toHaveBeenCalled();
  },
);
it('allows a newly accepted directory member to be selected without automatically provisioning them', async () => {
  identity.members.mockResolvedValue({
    items: [
      { userId: 'member', displayName: 'Nadia A.', email: 'nadia@example.test', status: 'ACTIVE' },
    ],
  });
  const f = await select();
  expect(f.componentInstance.options()[0].label).toContain('Nadia A.');
  expect(identity.assignInitialRole).not.toHaveBeenCalled();
  expect(api.bindStaff).not.toHaveBeenCalled();
});
it('preselects and identifies a directory member while preserving canonical lookup and provisioning', async () => {
  TestBed.overrideProvider(MAT_DIALOG_DATA, {
    useValue: {
      org: 'org',
      user: 'owner',
      member: { userId: 'member', displayName: 'Aïssatou S.', status: 'ACTIVE' },
    },
  });
  const f = await dialog();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.ready()).toBe(true);
  });
  expect(f.componentInstance.selected()).toBe('member');
  expect(f.nativeElement.querySelector('liass-searchable-select')).toBeNull();
  expect(f.nativeElement.textContent).toContain('Membre sélectionné');
  await f.componentInstance.submit();
  expect(api.bindStaff).toHaveBeenCalledTimes(1);
  expect(ref.close).toHaveBeenCalledWith(true);
});
it('does not recreate a preselected Staff member discovered by the canonical detail read', async () => {
  current = staffFixture('member');
  TestBed.overrideProvider(MAT_DIALOG_DATA, {
    useValue: {
      org: 'org',
      user: 'owner',
      member: { userId: 'member', displayName: 'Aïssatou S.', status: 'ACTIVE' },
    },
  });
  const f = await dialog();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.existing()).toBe(true);
  });
  await f.componentInstance.submit();
  expect(api.bindStaff).not.toHaveBeenCalled();
  expect(identity.assignInitialRole).not.toHaveBeenCalled();
});
it('closes a preselected dialog on context revision change even when organization and identity return', async () => {
  const revision = signal(1);
  TestBed.overrideProvider(AuthStore, {
    useValue: {
      effectiveOrgId: org,
      currentUserId: user,
      loadWorkspaces: refresh,
      contextRevision: revision,
    },
  });
  TestBed.overrideProvider(MAT_DIALOG_DATA, {
    useValue: {
      org: 'org',
      user: 'owner',
      member: { userId: 'member', displayName: 'Aïssatou S.', status: 'ACTIVE' },
    },
  });
  const f = await dialog();
  revision.set(3);
  f.detectChanges();
  await f.componentInstance.submit();
  expect(ref.close).toHaveBeenCalled();
  expect(identity.assignInitialRole).not.toHaveBeenCalled();
});
