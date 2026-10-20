import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { ZodError } from 'zod';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { restaurantKeys, RestaurantsQueries } from '../data-access/restaurants.queries';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { staffFixture, assignmentFixture, teamOutlets } from '../data-access/staff.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
import { RestaurantTeamPage } from './restaurant-team.page';
import { StaffAssignmentsDialogComponent } from './staff-assignments-dialog.component';
import { StaffStatusDialogComponent } from './staff-status-dialog.component';
const org = signal('org'),
  read = signal(true),
  manage = signal(true),
  provision = signal(false);
const api = {
  staff: vi.fn(),
  staffMember: vi.fn(),
  staffOutlets: vi.fn(),
  outletStaff: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  updateStaff: vi.fn(),
  staffAssignment: vi.fn(),
};
const notifications = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
let client: QueryClient;
let fixture:
  | { detectChanges: () => void; destroy: () => void; nativeElement: HTMLElement }
  | undefined;
const ref = { close: vi.fn(), disableClose: false };
beforeEach(() => {
  org.set('org');
  read.set(true);
  manage.set(true);
  provision.set(false);
  ref.close.mockReset();
  for (const mock of Object.values(api)) mock.mockReset();
  for (const mock of Object.values(notifications)) mock.mockReset();
  api.staff.mockResolvedValue({
    items: [
      staffFixture(),
      staffFixture('private-user-b', {
        displayName: 'Moussa D.',
        restaurantRole: 'CASHIER',
        status: 'INACTIVE',
      }),
    ],
  });
  api.staffMember.mockResolvedValue(staffFixture());
  api.staffOutlets.mockImplementation(async (_org, user) => ({
    items: [
      assignmentFixture(rid(2), { userId: user }),
      assignmentFixture(rid(4), { userId: user }),
    ],
  }));
  api.outletStaff.mockResolvedValue({
    items: [{ staff: staffFixture(), assignment: assignmentFixture() }],
  });
  api.list.mockResolvedValue({ items: teamOutlets });
  api.get.mockImplementation(async (_org, _kind, _ctx, id) =>
    teamOutlets.find((row) => row.id === id),
  );
  api.updateStaff.mockResolvedValue({
    data: staffFixture('private-user-a', { status: 'INACTIVE', version: 2 }),
    message: null,
  });
  api.staffAssignment.mockResolvedValue({ data: assignmentFixture(), message: null });
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
      { provide: AuthStore, useValue: { effectiveOrgId: org } },
      {
        provide: RestaurantsCapabilities,
        useValue: { canReadStaff: read, canManageStaff: manage, canProvisionStaff: provision },
      },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      { provide: RestaurantsApi, useValue: api },
      { provide: NotificationService, useValue: notifications },
      { provide: MAT_DIALOG_DATA, useValue: { org: 'org', staff: staffFixture() } },
      { provide: MatDialogRef, useValue: ref },
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
  const f = TestBed.createComponent(RestaurantTeamPage);
  fixture = f;
  f.detectChanges();
  await vi.waitFor(
    () => {
      f.detectChanges();
      expect(
        !read() || f.componentInstance.team.isSuccess() || f.componentInstance.team.isError(),
      ).toBe(true);
    },
    { timeout: 4000 },
  );
  return f;
}
async function editor() {
  const f = TestBed.createComponent(StaffAssignmentsDialogComponent);
  fixture = f;
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.assignments.isSuccess()).toBe(true);
    expect(f.componentInstance.member.isSuccess()).toBe(true);
  });
  f.detectChanges();
  await Promise.resolve();
  f.detectChanges();
  return f;
}
it('shows named staff, read-only roles, mixed lifecycle, current and inactive outlet labels without IDs', async () => {
  const f = await page();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Calavi');
  });
  const text = f.nativeElement.textContent!;
  for (const label of [
    'Équipe',
    'Aïssatou S.',
    'Moussa D.',
    'Serveur',
    'Caissier',
    'Actif',
    'Inactif',
    'Agla',
    'Calavi',
    'Établissement inactif',
  ])
    expect(text).toContain(label);
  for (const absent of [
    'private-user',
    '00000000',
    'Cognito',
    'Inviter',
    'Changer le rôle',
    'Ajouter à l’équipe',
  ])
    expect(text).not.toContain(absent);
  expect(f.nativeElement.querySelector('table[mat-table]')).not.toBeNull();
  expect(
    Array.from(f.nativeElement.querySelectorAll('th')).map((cell: unknown) =>
      (cell as HTMLElement).textContent?.trim(),
    ),
  ).toEqual(['Membre', 'Rôle', 'Statut', 'Établissements', 'Actions']);
  expect(f.nativeElement.querySelector('tbody tr td:last-child button')).not.toBeNull();
});
it('uses the unnamed-member fallback without exposing its canonical user reference', async () => {
  api.staff.mockResolvedValue({
    items: [staffFixture('opaque-person', { displayName: null, restaurantRole: null })],
  });
  const f = await page();
  expect(f.nativeElement.textContent).toContain('Membre de l’équipe');
  expect(f.nativeElement.textContent).not.toContain('opaque-person');
  expect(f.nativeElement.textContent).toContain('Rôle indisponible');
});
it('keeps staff management absent for read-only and denied viewers', async () => {
  manage.set(false);
  const f = await page();
  expect(f.nativeElement.textContent).not.toContain('Gérer les affectations');
  read.set(false);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('Vous n’avez pas accès');
  expect(f.nativeElement.textContent).not.toContain('Aïssatou');
});
it('never fetches staff when read permission is missing', async () => {
  read.set(false);
  await page();
  expect(api.staff).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
});
it('paginates explicitly and does not claim complete totals while pages remain', async () => {
  api.staff.mockImplementation(async (_org, cursor) =>
    cursor
      ? { items: [staffFixture('private-user-b', { displayName: 'Moussa D.' })] }
      : { items: [staffFixture()], nextCursor: 'opaque-next' },
  );
  const f = await page();
  expect(api.staff).toHaveBeenCalledTimes(1);
  expect(f.nativeElement.textContent).not.toContain('1 membre affiché');
  await f.componentInstance.team.fetchNextPage();
  f.detectChanges();
  expect(api.staff).toHaveBeenLastCalledWith('org', 'opaque-next');
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.members()).toHaveLength(2);
  });
});
it('uses the outlet-scoped directory, excludes retained inactive relations, and applies a local status filter', async () => {
  api.outletStaff.mockResolvedValue({
    items: [
      { staff: staffFixture(), assignment: assignmentFixture() },
      {
        staff: staffFixture('private-user-b'),
        assignment: assignmentFixture(rid(2), { userId: 'private-user-b', status: 'INACTIVE' }),
      },
    ],
  });
  const f = await page();
  f.componentInstance.outletFilter.setValue(rid(2));
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(api.outletStaff).toHaveBeenCalledWith('org', rid(2), undefined);
    expect(f.componentInstance.filtered.isSuccess()).toBe(true);
  });
  expect(f.componentInstance.members()).toHaveLength(1);
  f.componentInstance.statusFilter.setValue('INACTIVE');
  f.detectChanges();
  expect(f.componentInstance.members()).toEqual([]);
  expect(f.nativeElement.textContent).toContain('Aucun membre');
});
it('distinguishes the empty directory and a partial-page empty filter result', async () => {
  api.staff.mockResolvedValue({ items: [] });
  const f = await page();
  expect(f.nativeElement.textContent).toContain('Votre équipe n’est pas encore configurée');
  expect(f.nativeElement.textContent).toContain('appartenir à cet espace de travail');
  client.setQueryData(restaurantKeys.staff('org'), {
    pages: [{ items: [], nextCursor: 'more' }],
    pageParams: [undefined],
  });
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('membres chargés');
  });
});
it.each([400, 403, 404, 409, 0])(
  'handles page HTTP %s without raw technical content',
  async (status) => {
    api.staff.mockRejectedValue(
      new HttpErrorResponse({ status, error: { message: 'DynamoDB PK stack exception' } }),
    );
    const f = await page();
    expect(f.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(f.nativeElement.textContent).not.toContain('DynamoDB');
    expect(f.nativeElement.textContent).not.toContain('private-user');
  },
);
it('handles a schema failure without exposing Zod errors', async () => {
  api.staff.mockRejectedValue(
    new ZodError([{ code: 'custom', path: [], message: 'private schema' }]),
  );
  const f = await page();
  expect(f.nativeElement.textContent).toContain('informations n’ont pas pu être lues');
  expect(f.nativeElement.textContent).not.toContain('private schema');
});
it('isolates organization queries and clears filters without showing a previous team', async () => {
  const f = await page();
  org.set('other');
  api.staff.mockImplementation(() => new Promise(() => {}));
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(api.staff).toHaveBeenCalledWith('other', undefined);
  });
  expect(f.nativeElement.textContent).not.toContain('Aïssatou');
  expect(f.componentInstance.outletId()).toBeNull();
  expect(restaurantKeys.staffOutlets('org', 'a')).not.toEqual(
    restaurantKeys.staffOutlets('other', 'a'),
  );
});
it('blocks editing until all assignment pages have been explicitly loaded', async () => {
  api.staffOutlets.mockImplementation(async (_org, _id, cursor) =>
    cursor
      ? { items: [assignmentFixture(rid(3))] }
      : { items: [assignmentFixture()], nextCursor: 'more' },
  );
  const f = await editor();
  expect(f.componentInstance.complete()).toBe(false);
  await f.componentInstance.save();
  expect(api.staffAssignment).not.toHaveBeenCalled();
  await f.componentInstance.assignments.fetchNextPage();
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.initialized()).toBe(true);
  });
  expect(f.componentInstance.wasAssigned(rid(3))).toBe(true);
});
it('edits a coherent multi-outlet delta and reports success only after every command', async () => {
  const f = await editor();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.control(rid(3))).toBeDefined();
  });
  f.componentInstance.control(rid(2)).setValue(false);
  f.componentInstance.control(rid(3)).setValue(true);
  await f.componentInstance.save();
  expect(api.staffAssignment).toHaveBeenCalledTimes(2);
  expect(api.staffAssignment.mock.calls[0].slice(1, 4)).toEqual(['private-user-a', rid(2), false]);
  expect(api.staffAssignment.mock.calls[1][4].clientRequestId).not.toBe(
    api.staffAssignment.mock.calls[0][4].clientRequestId,
  );
  expect(notifications.success).toHaveBeenCalledTimes(1);
  expect(ref.close).toHaveBeenCalledWith(true);
});
it('preserves partial failures and retries the uncertain command with the same intent', async () => {
  const f = await editor();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.control(rid(3))).toBeDefined();
  });
  f.componentInstance.control(rid(2)).setValue(false);
  f.componentInstance.control(rid(3)).setValue(true);
  api.staffAssignment
    .mockResolvedValueOnce({ message: null })
    .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await f.componentInstance.save();
  f.detectChanges();
  expect(notifications.success).not.toHaveBeenCalled();
  expect(ref.close).not.toHaveBeenCalled();
  expect(f.nativeElement.textContent).toContain('Certains ont pu être enregistrés');
  const failedPayload = api.staffAssignment.mock.calls[1][4];
  api.staffAssignment.mockResolvedValue({ message: null });
  await f.componentInstance.save();
  expect(api.staffAssignment).toHaveBeenCalledTimes(3);
  expect(api.staffAssignment.mock.calls[2][4]).toEqual(failedPayload);
  expect(notifications.success).toHaveBeenCalledTimes(1);
});
it('duplicate submissions and organization switches cannot send a second batch', async () => {
  const f = await editor();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.control(rid(3))).toBeDefined();
  });
  f.componentInstance.control(rid(3)).setValue(true);
  let resolve!: (value: { message: null }) => void;
  api.staffAssignment.mockImplementation(() => new Promise((done) => (resolve = done)));
  const save = f.componentInstance.save();
  await Promise.resolve();
  await f.componentInstance.save();
  expect(api.staffAssignment).toHaveBeenCalledTimes(1);
  org.set('other');
  f.detectChanges();
  resolve({ message: null });
  await save;
  expect(notifications.success).not.toHaveBeenCalled();
});
it('reloading after a partial failure discards the old choices for authoritative review', async () => {
  const f = await editor();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.control(rid(3))).toBeDefined();
  });
  f.componentInstance.control(rid(3)).setValue(true);
  api.staffAssignment.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
  await f.componentInstance.save();
  expect(f.componentInstance.locked()).toBe(true);
  await f.componentInstance.reload();
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.control(rid(3))?.value).toBe(false);
  });
  expect(f.componentInstance.locked()).toBe(false);
});
it('lifecycle retries retain expectedVersion and UUID; safe response messages drive notifications', async () => {
  const f = TestBed.createComponent(StaffStatusDialogComponent);
  fixture = f;
  f.detectChanges();
  api.updateStaff.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await f.componentInstance.confirm();
  const intent = api.updateStaff.mock.calls[0][2];
  api.updateStaff.mockResolvedValue({ message: 'Membre désactivé.' });
  await f.componentInstance.confirm();
  expect(api.updateStaff.mock.calls[1][2]).toEqual(intent);
  expect(intent).toMatchObject({ status: 'INACTIVE', expectedVersion: 1 });
  expect(notifications.success).toHaveBeenCalledWith('Membre désactivé.');
});
it('invalidates only affected staff/establishment caches after assignment changes', async () => {
  const queries = TestBed.inject(RestaurantsQueries),
    invalidate = vi.spyOn(client, 'invalidateQueries');
  await queries.staffAssignmentsChanged('org', 'private-user-a', [rid(2), rid(2)]);
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: restaurantKeys.staffOutlets('org', 'private-user-a'),
    exact: true,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: restaurantKeys.outletStaff('org', rid(2)),
    exact: true,
  });
});

it('does not silently rebase an editing form onto a changed assignment version', async () => {
  const f = await editor();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.initialized()).toBe(true);
  });
  client.setQueryData(restaurantKeys.staffOutlets('org', 'private-user-a'), {
    pages: [
      {
        items: [
          assignmentFixture(rid(2), { status: 'INACTIVE', version: 2 }),
          assignmentFixture(rid(4)),
        ],
      },
    ],
    pageParams: [undefined],
  });
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.stale()).toBe(true);
  });
  await f.componentInstance.save();
  expect(api.staffAssignment).not.toHaveBeenCalled();
});

it('hydrates references outside the loaded outlet page and uses a safe unavailable label on 404', async () => {
  api.staffOutlets.mockResolvedValue({ items: [assignmentFixture(rid(90))] });
  api.get.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
  const f = await page();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Établissement indisponible');
  });
  expect(api.get).toHaveBeenCalledWith('org', 'outlet', {}, rid(90));
  expect(f.nativeElement.textContent).not.toContain(rid(90));
});
it('reactivates a retained inactive staff member through the versioned lifecycle command', async () => {
  TestBed.overrideProvider(MAT_DIALOG_DATA, {
    useValue: {
      org: 'org',
      staff: staffFixture('private-user-a', { status: 'INACTIVE', version: 7 }),
    },
  });
  const f = TestBed.createComponent(StaffStatusDialogComponent);
  fixture = f;
  f.detectChanges();
  await f.componentInstance.confirm();
  expect(api.updateStaff).toHaveBeenCalledWith(
    'org',
    'private-user-a',
    expect.objectContaining({ status: 'ACTIVE', expectedVersion: 7 }),
  );
});

it('does not expose internal response-context exceptions as business guidance', async () => {
  api.staff.mockRejectedValue(new Error('Mismatched staff context private-user-a'));
  const f = await page();
  expect(f.nativeElement.textContent).not.toContain('Mismatched');
  expect(f.nativeElement.textContent).not.toContain('private-user-a');
  expect(f.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
});

it('restores lifecycle-dialog focus to the persistent member menu trigger', async () => {
  const f = await page();
  const button = f.nativeElement.querySelector(
    'button[aria-label="Actions pour Aïssatou S."]',
  ) as HTMLButtonElement;
  const focus = vi.spyOn(button, 'focus');
  vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
    afterClosed: () => of(true),
  } as unknown as ReturnType<MatDialog['open']>);
  f.componentInstance.changeStatus(staffFixture(), button);
  expect(focus).toHaveBeenCalledOnce();
});

it('offers assignment and lifecycle commands only through the last-column Material menu', async () => {
  const f = await page();
  const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
    afterClosed: () => of(undefined),
  } as unknown as ReturnType<MatDialog['open']>);
  const trigger = f.nativeElement.querySelector(
    'tbody tr td:last-child button',
  ) as HTMLButtonElement;
  expect(
    f.nativeElement.querySelector('tbody tr td:not(:last-child) button[aria-haspopup]'),
  ).toBeNull();
  trigger.click();
  f.detectChanges();
  const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]'));
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining('Gérer les affectations'),
    expect.stringContaining('Désactiver'),
  ]);
  items[0].click();
  f.detectChanges();
  expect(open).toHaveBeenCalledWith(
    StaffAssignmentsDialogComponent,
    expect.objectContaining({ restoreFocus: false }),
  );
});
it('keeps inactive-member reactivation reachable and hides all management triggers in read-only mode', async () => {
  const f = await page();
  const trigger = f.nativeElement.querySelector(
    'button[aria-label="Actions pour Moussa D."]',
  ) as HTMLButtonElement;
  trigger.click();
  f.detectChanges();
  expect(document.querySelector('.cdk-overlay-container')?.textContent).toContain('Réactiver');
  manage.set(false);
  f.detectChanges();
  expect(f.nativeElement.querySelector('button[aria-haspopup]')).toBeNull();
});
it('restores assignment-dialog focus to the persistent row menu trigger', async () => {
  const f = await page();
  const button = f.nativeElement.querySelector(
    'button[aria-label="Actions pour Aïssatou S."]',
  ) as HTMLButtonElement;
  const focus = vi.spyOn(button, 'focus');
  vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
    afterClosed: () => of(true),
  } as unknown as ReturnType<MatDialog['open']>);
  f.componentInstance.manageAssignments(staffFixture(), button);
  expect(focus).toHaveBeenCalledOnce();
});
it('places the search/filter toolbar directly above the table without settings, count or unsupported add action', async () => {
  localStorage.setItem(
    'liass.table-preferences.restaurants.team',
    JSON.stringify({ visibleColumnIds: ['member', 'actions'] }),
  );
  const f = await page();
  const collection = f.nativeElement.querySelector(
    '[data-testid="team-management-collection"]',
  ) as HTMLElement;
  const toolbar = collection.querySelector('section') as HTMLElement;
  expect(toolbar.querySelector('input[type="search"]')).not.toBeNull();
  expect(toolbar.querySelector('mat-select')).not.toBeNull();
  expect(toolbar.nextElementSibling?.classList.contains('team-collection')).toBe(true);
  expect(
    Array.from(f.nativeElement.querySelectorAll('mat-icon')).some(
      (icon: unknown) => (icon as HTMLElement).textContent?.trim() === 'settings',
    ),
  ).toBe(false);
  expect(f.nativeElement.textContent).not.toMatch(/\d+ membre/);
  expect(f.nativeElement.textContent).not.toContain('Ajouter un membre');
  expect(f.nativeElement.textContent).not.toContain('Inviter');
  expect(f.nativeElement.querySelectorAll('th')).toHaveLength(5);
  expect(f.nativeElement.querySelector('th:last-child')?.textContent?.trim()).toBe('Actions');
  expect(f.nativeElement.querySelector('tbody td:last-child button')).not.toBeNull();
  localStorage.removeItem('liass.table-preferences.restaurants.team');
});

it('keeps many outlet labels concise while allowing expansion without loading extra pages', async () => {
  api.staff.mockResolvedValue({ items: [staffFixture()] });
  api.staffOutlets.mockResolvedValue({
    items: [assignmentFixture(rid(2)), assignmentFixture(rid(4)), assignmentFixture(rid(3))],
  });
  const f = await page();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('+1');
  });
  const summary = f.nativeElement.querySelector('liass-staff-assignments-summary') as HTMLElement;
  expect(summary.textContent).not.toContain('Fidjrossè');
  const toggle = summary.querySelector('[aria-expanded]') as HTMLButtonElement;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  f.detectChanges();
  expect(summary.textContent).toContain('Fidjrossè');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(api.staffOutlets).toHaveBeenCalledTimes(1);
});

it('provides labelled Material name search and a keyboard-accessible clear action', async () => {
  const f = await page();
  const input = f.nativeElement.querySelector('input[type="search"][matInput]') as HTMLInputElement;
  expect(input).not.toBeNull();
  expect(f.nativeElement.querySelector('mat-label')?.textContent).toContain('Rechercher un membre');
  input.value = 'MOUSSA';
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
  expect(f.componentInstance.members().map((row) => row.displayName)).toEqual(['Moussa D.']);
  const clear = f.nativeElement.querySelector(
    'button[aria-label="Effacer la recherche"]',
  ) as HTMLButtonElement;
  clear.click();
  f.detectChanges();
  expect(f.componentInstance.search()).toBe('');
  expect(f.componentInstance.members()).toHaveLength(2);
  expect(f.nativeElement.querySelector('th:last-child')?.textContent?.trim()).toBe('Actions');
});
it('normalizes case, accents and whitespace for display-name matching without extra requests', async () => {
  const f = await page();
  const before = api.staff.mock.calls.length;
  f.componentInstance.searchFilter.setValue('  AISSAtoU  ');
  f.detectChanges();
  expect(f.componentInstance.members().map((row) => row.displayName)).toEqual(['Aïssatou S.']);
  expect(api.staff.mock.calls).toHaveLength(before);
});
it('shows a distinct no-match state and never searches opaque user references', async () => {
  const f = await page();
  for (const query of ['not-a-person', 'private-user-a']) {
    f.componentInstance.searchFilter.setValue(query);
    f.detectChanges();
    expect(f.componentInstance.members()).toEqual([]);
    expect(f.nativeElement.textContent).toContain('Aucun membre ne correspond à votre recherche.');
    expect(f.nativeElement.textContent).not.toContain('Votre équipe n’est pas encore configurée');
    expect(f.nativeElement.textContent).not.toContain('private-user-a');
  }
});
it('intersects search, establishment and status without resetting another control', async () => {
  api.outletStaff.mockResolvedValue({
    items: [
      { staff: staffFixture(), assignment: assignmentFixture() },
      {
        staff: staffFixture('private-user-b', { displayName: 'Moussa D.', status: 'INACTIVE' }),
        assignment: assignmentFixture(rid(2), { userId: 'private-user-b' }),
      },
    ],
  });
  const f = await page();
  f.componentInstance.searchFilter.setValue('Moussa');
  f.componentInstance.statusFilter.setValue('INACTIVE');
  f.componentInstance.outletFilter.setValue(rid(2));
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.filtered.isSuccess()).toBe(true);
  });
  expect(f.componentInstance.members().map((row) => row.displayName)).toEqual(['Moussa D.']);
  f.componentInstance.statusFilter.setValue('ACTIVE');
  f.detectChanges();
  expect(f.componentInstance.members()).toEqual([]);
  expect(f.componentInstance.searchFilter.value).toBe('Moussa');
  expect(f.componentInstance.outletFilter.value).toBe(rid(2));
  f.componentInstance.searchFilter.reset('');
  f.detectChanges();
  expect(f.componentInstance.members().map((row) => row.displayName)).toEqual(['Aïssatou S.']);
  expect(f.componentInstance.statusFilter.value).toBe('ACTIVE');
});
it('discloses loaded-page scope and retains manual cursor pagination during search', async () => {
  api.staff.mockImplementation(async (_org, cursor) =>
    cursor
      ? { items: [staffFixture('private-user-b', { displayName: 'Moussa D.' })] }
      : { items: [staffFixture()], nextCursor: 'opaque-next' },
  );
  const f = await page();
  f.componentInstance.searchFilter.setValue('Moussa');
  f.detectChanges();
  expect(f.componentInstance.members()).toEqual([]);
  expect(f.nativeElement.textContent).toContain('La recherche porte sur les membres chargés.');
  expect(
    f.nativeElement.querySelector('input[type="search"]')?.getAttribute('aria-describedby'),
  ).toBe('team-search-scope');
  expect(api.staff).toHaveBeenCalledTimes(1);
  expect(f.nativeElement.textContent).toContain('Afficher d’autres membres');
  await f.componentInstance.source().fetchNextPage();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(f.componentInstance.members()).toHaveLength(1);
  });
  expect(api.staff).toHaveBeenLastCalledWith('org', 'opaque-next');
  expect(f.componentInstance.searchFilter.value).toBe('Moussa');
  expect(f.nativeElement.querySelector('#team-search-scope')).toBeNull();
  expect(f.nativeElement.textContent).not.toContain('1 membre affiché');
});
it('resets local search when the organization changes', async () => {
  const f = await page();
  f.componentInstance.searchFilter.setValue('Aïssatou');
  f.detectChanges();
  org.set('another-org');
  f.detectChanges();
  expect(f.componentInstance.searchFilter.value).toBe('');
  await vi.waitFor(() => expect(api.staff).toHaveBeenCalledWith('another-org', undefined));
});

it.each([
  ['MANAGER', 'Gérant'],
  ['KITCHEN', 'Cuisinier'],
] as const)(
  'presents canonical %s with its French restaurant label',
  async (restaurantRole, label) => {
    api.staff.mockResolvedValue({ items: [staffFixture('private-user-a', { restaurantRole })] });
    const f = await page();
    expect(f.nativeElement.querySelector('td.mat-column-role')?.textContent?.trim()).toBe(label);
    expect(f.componentInstance.members()[0].restaurantRole).toBe(restaurantRole);
  },
);

it('OWNER provisioning stays inside the surface with its toolbar and empty state', async () => {
  provision.set(true);
  api.staff.mockResolvedValue({ items: [] });
  const f = await page();
  const buttons = Array.from(f.nativeElement.querySelectorAll('button')).filter((button: unknown) =>
    (button as HTMLElement).textContent?.includes('Ajouter un membre'),
  );
  expect(buttons).toHaveLength(2);
  expect(f.nativeElement.querySelector('liass-page-header')?.textContent).not.toContain(
    'Ajouter un membre',
  );
  expect(
    f.nativeElement.querySelector('[data-testid="collection-primary-action"]')?.textContent,
  ).toContain('Ajouter un membre');
  const surface = f.nativeElement.querySelector('[data-testid="management-work-surface"]');
  expect(surface.querySelector('section input[type="search"]')).not.toBeNull();
  expect(surface.textContent).toContain('Votre équipe n’est pas encore configurée');
});
it('MANAGER retains row management without an Add member control', async () => {
  const f = await page();
  expect(f.nativeElement.textContent).not.toContain('Ajouter un membre');
  expect(f.nativeElement.querySelector('tbody button[aria-haspopup]')).not.toBeNull();
});
