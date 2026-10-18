import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { ZodError } from 'zod';
import fr from '../../../../../public/assets/i18n/fr.json';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { NotificationService } from '../../../core/notifications/notification.service';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { RestaurantsApi } from '../data-access/restaurants.api';
import { RestaurantsQueries, restaurantKeys } from '../data-access/restaurants.queries';
import {
  ResponsibleStaffDialogComponent,
  ResponsibleStaffDialogData,
} from './responsible-staff-dialog.component';
import { floorFixture } from '../data-access/service-floor.test-fixture';
import { sessionFixture } from '../data-access/responsible-staff.test-fixture';
import { staffFixture, assignmentFixture } from '../data-access/staff.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
let org = signal('org'),
  manage = signal(true),
  current = signal(true);
let client: QueryClient,
  f: ReturnType<typeof TestBed.createComponent<ResponsibleStaffDialogComponent>>;
let data: ResponsibleStaffDialogData;
const api = { guestSession: vi.fn(), outletStaff: vi.fn(), replaceResponsibleStaff: vi.fn() };
const ref = { close: vi.fn(), disableClose: false },
  notices = { success: vi.fn() };
const entry = (
  id = 'person',
  role: 'WAITER' | 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' = 'WAITER',
) => ({
  staff: staffFixture(id, { displayName: 'Aïssatou S.', restaurantRole: role }),
  assignment: assignmentFixture(rid(2), { userId: id }),
});
beforeEach(() => {
  org = signal('org');
  manage = signal(true);
  current = signal(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const mock of [...Object.values(api), ref.close, notices.success]) mock.mockReset();
  api.guestSession.mockResolvedValue(sessionFixture());
  api.outletStaff.mockResolvedValue({ items: [entry()] });
  api.replaceResponsibleStaff.mockResolvedValue({ data: sessionFixture(), message: null });
  const table = floorFixture().items[1];
  if (table.state !== 'OCCUPIED') throw new Error('Occupied fixture');
  data = {
    org: 'org',
    outletId: rid(2),
    table,
    clear: false,
    intent: {},
    isCurrent: () => current(),
    canAssign: () => true,
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { fr },
        translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: AuthStore, useValue: { effectiveOrgId: org } },
      { provide: QueryClient, useValue: client },
      { provide: RestaurantsApi, useValue: api },
      { provide: RestaurantsCapabilities, useValue: { canManageResponsibility: manage } },
      { provide: ProductAccessState, useValue: { availability: () => 'AVAILABLE' } },
      { provide: NotificationService, useValue: notices },
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: ref },
    ],
  });
});
it('uses the table name in operational context and confirmation without its code', async () => {
  data.table = { ...data.table, name: 'TEST CHRIS' };
  data.clear = true;
  await create();
  expect(f.nativeElement.textContent).toContain('TEST CHRIS');
  expect(f.nativeElement.textContent).not.toContain('T02');
});
afterEach(() => {
  f?.destroy();
  client.clear();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
async function create() {
  f = TestBed.createComponent(ResponsibleStaffDialogComponent);
  f.detectChanges();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(
      (f.componentInstance.session.isSuccess() && !f.componentInstance.session.isFetching()) ||
        f.componentInstance.session.isError() ||
        !manage(),
    ).toBe(true);
  });
  if (!data.clear && manage())
    await vi.waitFor(() => {
      f.detectChanges();
      expect(
        (f.componentInstance.candidates.isSuccess() &&
          !f.componentInstance.candidates.isFetching()) ||
          f.componentInstance.candidates.isError(),
      ).toBe(true);
    });
  return f.componentInstance;
}
it('loads the canonical session version and only known active eligible outlet staff', async () => {
  const inactive = entry('inactive');
  inactive.staff.status = 'INACTIVE';
  const unassigned = entry('unassigned');
  unassigned.assignment.status = 'INACTIVE';
  const membership = entry('membership');
  membership.staff.organizationMembershipActive = false;
  const foreign = entry('foreign');
  foreign.assignment.outletId = rid(22);
  api.outletStaff.mockResolvedValue({
    items: [
      entry(),
      entry('manager', 'MANAGER'),
      entry('owner', 'OWNER'),
      entry('cashier', 'CASHIER'),
      entry('cook', 'KITCHEN'),
      inactive,
      unassigned,
      membership,
      foreign,
    ],
  });
  const component = await create();
  expect(component.options().map((o) => o.value)).toEqual(['person', 'manager', 'owner']);
  expect(component.options().map((o) => o.label)).toEqual([
    'Aïssatou S. · Serveur',
    'Aïssatou S. · Gérant',
    'Aïssatou S. · Propriétaire',
  ]);
  expect(api.guestSession).toHaveBeenCalledWith('org', rid(2), rid(9));
  component.selection.setValue('person');
  await component.save();
  expect(api.replaceResponsibleStaff).toHaveBeenCalledWith('org', rid(2), rid(9), {
    staffId: 'person',
    expectedVersion: 7,
    clientRequestId: expect.any(String),
  });
  expect(ref.close).toHaveBeenCalledWith(true);
  expect(f.nativeElement.textContent).not.toMatch(/private-opener|rid\(|person\/|Cognito/);
});
it('invalidates only captured floor/session keys after success', async () => {
  const component = await create();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  component.selection.setValue('person');
  await component.save();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: restaurantKeys.floor('org', rid(2)),
    exact: true,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: restaurantKeys.session('org', rid(2), rid(9)),
  });
  expect(invalidate).not.toHaveBeenCalledWith({
    queryKey: restaurantKeys.floor('another-org', rid(2)),
    exact: true,
  });
});
it('reassigns an existing responsible person and clears with an explicit null command', async () => {
  api.guestSession.mockResolvedValue(
    sessionFixture({
      responsibleStaff: { staffId: 'previous', displayName: 'Moussa D.', available: true },
    }),
  );
  data.clear = true;
  const component = await create();
  expect(f.nativeElement.textContent).toContain('Retirer Moussa D. de la table T02');
  expect(api.outletStaff).not.toHaveBeenCalled();
  await component.save();
  expect(api.replaceResponsibleStaff.mock.calls[0][3]).toMatchObject({
    staffId: null,
    expectedVersion: 7,
  });
});
it('does not infer a complete empty candidate list from an ineligible first page', async () => {
  api.outletStaff.mockImplementation(async (_org, _outlet, cursor) =>
    cursor ? { items: [entry()] } : { items: [entry('cashier', 'CASHIER')], nextCursor: 'opaque' },
  );
  const component = await create();
  expect(component.options()).toHaveLength(0);
  expect(f.nativeElement.textContent).toContain('Recherche parmi les membres chargés');
  expect(f.nativeElement.textContent).not.toContain('Aucun membre éligible');
  expect(api.outletStaff).toHaveBeenCalledTimes(1);
  await component.candidates.fetchNextPage();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(component.options()).toHaveLength(1);
  });
  expect(api.outletStaff).toHaveBeenLastCalledWith('org', rid(2), 'opaque');
});
it.each([0, 503, 'zod'])(
  'retries ambiguous %s with identical intent even after a new session version',
  async (kind) => {
    api.replaceResponsibleStaff.mockRejectedValueOnce(
      kind === 'zod' ? new ZodError([]) : new HttpErrorResponse({ status: kind as number }),
    );
    const component = await create();
    component.selection.setValue('person');
    await component.save();
    const original = { ...api.replaceResponsibleStaff.mock.calls[0][3] };
    expect(component.ambiguous()).toBe(true);
    expect(data.intent.current).toEqual(original);
    api.guestSession.mockResolvedValue(sessionFixture({ version: 12 }));
    await component.refresh();
    await component.save();
    expect(api.replaceResponsibleStaff.mock.calls[1][3]).toEqual(original);
    expect(data.intent.current).toBeUndefined();
  },
);
it('preserves ambiguous command intent across cancel/reopen', async () => {
  api.replaceResponsibleStaff.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  let component = await create();
  component.selection.setValue('person');
  await component.save();
  const original = api.replaceResponsibleStaff.mock.calls[0][3];
  component.cancel();
  f.destroy();
  component = await create();
  await component.save();
  expect(api.replaceResponsibleStaff.mock.calls[1][3]).toEqual(original);
});
it('prevents duplicate submit while pending', async () => {
  let finish!: (value: unknown) => void;
  api.replaceResponsibleStaff.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const component = await create();
  component.selection.setValue('person');
  const first = component.save();
  await component.save();
  expect(api.replaceResponsibleStaff).toHaveBeenCalledTimes(1);
  finish({ data: sessionFixture(), message: null });
  await first;
});
it.each([400, 403, 404, 409])(
  'handles HTTP %s safely and refreshes candidates/session/floor',
  async (status) => {
    api.replaceResponsibleStaff.mockRejectedValue(
      new HttpErrorResponse({ status, error: { message: 'DynamoDB PK stack exception' } }),
    );
    const component = await create();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    component.selection.setValue('person');
    await component.save();
    f.detectChanges();
    expect(ref.close).not.toHaveBeenCalledWith(true);
    expect(component.error()).not.toMatch(/PK|DynamoDB|stack/);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: restaurantKeys.outletStaff('org', rid(2)),
      exact: true,
    });
    if (status === 409) {
      expect(component.error()).toContain('Les dernières informations ont été rechargées');
      expect(data.intent.current).toBeUndefined();
      expect(component.selected()).toBeNull();
    }
    if (status === 403) expect(component.canSubmit()).toBe(false);
  },
);
it('refreshes changed eligibility after a conflict and requires a new explicit choice', async () => {
  const component = await create();
  component.selection.setValue('person');
  api.outletStaff.mockResolvedValue({ items: [entry('cashier', 'CASHIER')] });
  api.replaceResponsibleStaff.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
  await component.save();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(component.options()).toHaveLength(0);
  });
  expect(component.canSubmit()).toBe(false);
});
it('does not submit stale/closed/wrong-table sessions or permit cross-organization/outlet actions', async () => {
  const component = await create();
  component.selection.setValue('person');
  current.set(false);
  f.detectChanges();
  await component.save();
  expect(api.replaceResponsibleStaff).not.toHaveBeenCalled();
  current.set(true);
  org.set('foreign');
  f.detectChanges();
  await component.save();
  expect(api.replaceResponsibleStaff).not.toHaveBeenCalled();
  expect(ref.close).toHaveBeenCalled();
});
it.each([{ status: 'CLOSED' as const }, { tableId: rid(77) }])(
  'rejects a nonassignable canonical session %j',
  async (changes) => {
    api.guestSession.mockResolvedValue(sessionFixture(changes));
    const component = await create();
    component.selection.setValue('person');
    await component.save();
    expect(api.replaceResponsibleStaff).not.toHaveBeenCalled();
  },
);
it('keeps management unavailable without permission', async () => {
  manage.set(false);
  const component = await create();
  await component.save();
  expect(api.guestSession).not.toHaveBeenCalled();
  expect(api.outletStaff).not.toHaveBeenCalled();
  expect(api.replaceResponsibleStaff).not.toHaveBeenCalled();
});

it('reassigns using the fresh session version, never a table version or foreign cached session', async () => {
  client.setQueryData(
    restaurantKeys.session('foreign', rid(2), rid(9)),
    sessionFixture({ orgId: 'foreign', version: 999 }),
  );
  client.setQueryData(
    restaurantKeys.session('org', rid(77), rid(9)),
    sessionFixture({ outletId: rid(77), version: 777 }),
  );
  api.guestSession.mockResolvedValue(
    sessionFixture({
      version: 13,
      responsibleStaff: { staffId: 'previous', displayName: 'Moussa D.', available: true },
    }),
  );
  const component = await create();
  component.selection.setValue('person');
  await component.save();
  expect(api.replaceResponsibleStaff.mock.calls[0][3]).toMatchObject({
    expectedVersion: 13,
    staffId: 'person',
  });
});
it('refreshes on stale conflict but does not resubmit until the manager explicitly confirms again', async () => {
  const component = await create();
  component.selection.setValue('person');
  api.guestSession.mockResolvedValue(sessionFixture({ version: 8 }));
  api.replaceResponsibleStaff.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
  await component.save();
  await vi.waitFor(() => {
    f.detectChanges();
    expect(component.session.data()?.version).toBe(8);
    expect(component.session.isFetching()).toBe(false);
  });
  expect(api.replaceResponsibleStaff).toHaveBeenCalledTimes(1);
  component.selection.setValue('person');
  await component.save();
  const calls = api.replaceResponsibleStaff.mock.calls;
  expect(calls[1][3]).toMatchObject({ expectedVersion: 8, staffId: 'person' });
  expect(calls[1][3].clientRequestId).not.toBe(calls[0][3].clientRequestId);
});
it('keeps a malformed session response blocking and never submits', async () => {
  api.guestSession.mockRejectedValue(new ZodError([]));
  const component = await create();
  component.selection.setValue('person');
  await component.save();
  expect(api.replaceResponsibleStaff).not.toHaveBeenCalled();
  expect(f.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
});
