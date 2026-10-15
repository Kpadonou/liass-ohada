import { HttpErrorResponse } from '@angular/common/http';
import {
  StaffProvisioningIntent,
  StaffProvisioningIssue,
  type ProvisioningPorts,
} from './staff-provisioning';
import { staffFixture, assignmentFixture } from '../data-access/staff.test-fixture';
import type { RestaurantStaff, RestaurantStaffOutlet } from '@liass-ohada/shared/restaurants';
const user = 'private-user-a';
const conflict = (code: string) =>
  new HttpErrorResponse({ status: 409, error: { error: { code } } });
let current: RestaurantStaff | null, rows: RestaurantStaffOutlet[], ports: ProvisioningPorts;
beforeEach(() => {
  current = null;
  rows = [];
  ports = {
    check: vi.fn(),
    role: vi.fn().mockResolvedValue({ role: 'WAITER' }),
    staff: vi.fn(async () => current),
    bind: vi.fn(async () => (current = staffFixture())),
    reactivate: vi.fn(async () => (current = staffFixture(user, { version: 3 }))),
    assignments: vi.fn(async () => ({ items: rows, complete: true })),
    assign: vi.fn(async (id) => {
      rows.push(assignmentFixture(id));
    }),
  };
});
it('composes role, create and zero outlets without extra assignment commands', async () => {
  await new StaffProvisioningIntent(user, 'WAITER', []).run(ports);
  expect(ports.role).toHaveBeenCalledWith({ role: 'WAITER', clientRequestId: expect.any(String) });
  expect(ports.bind).toHaveBeenCalledWith({
    memberUserId: user,
    clientRequestId: expect.any(String),
  });
  expect(ports.assignments).not.toHaveBeenCalled();
});
it('retains role and bind request IDs after an ambiguous non-committed create', async () => {
  const intent = new StaffProvisioningIntent(user, 'WAITER', []);
  vi.mocked(ports.bind).mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await expect(intent.run(ports)).rejects.toBeInstanceOf(HttpErrorResponse);
  await intent.run(ports);
  expect(vi.mocked(ports.bind).mock.calls[0]).toEqual(vi.mocked(ports.bind).mock.calls[1]);
  expect(vi.mocked(ports.role).mock.calls[0]).toEqual(vi.mocked(ports.role).mock.calls[1]);
});
it('readback resolves an ambiguous committed create and avoids recreating Staff', async () => {
  const intent = new StaffProvisioningIntent(user, 'WAITER', ['a']);
  vi.mocked(ports.bind).mockImplementationOnce(async () => {
    current = staffFixture();
    throw new HttpErrorResponse({ status: 0 });
  });
  await expect(intent.run(ports)).rejects.toBeInstanceOf(HttpErrorResponse);
  await intent.run(ports);
  expect(ports.bind).toHaveBeenCalledTimes(1);
  expect(ports.assign).toHaveBeenCalledTimes(1);
});
it('outlet A success and B failure resume B with same ID without duplicating A', async () => {
  const intent = new StaffProvisioningIntent(user, 'WAITER', ['a', 'b']);
  let failed = false;
  vi.mocked(ports.assign).mockImplementation(async (id) => {
    if (id === 'b' && !failed) {
      failed = true;
      throw new HttpErrorResponse({ status: 0 });
    }
    rows.push(assignmentFixture(id));
  });
  await expect(intent.run(ports)).rejects.toBeInstanceOf(HttpErrorResponse);
  await intent.run(ports);
  expect(vi.mocked(ports.assign).mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'b']);
  expect(vi.mocked(ports.assign).mock.calls[1][1]).toEqual(
    vi.mocked(ports.assign).mock.calls[2][1],
  );
  expect(
    new Set(vi.mocked(ports.assign).mock.calls.map((call) => call[1].clientRequestId)).size,
  ).toBe(2);
});
it('different initial role stops before any Staff read/write', async () => {
  vi.mocked(ports.role).mockRejectedValue(conflict('PLATFORM_PRODUCT_ROLE_CONFLICT'));
  await expect(new StaffProvisioningIntent(user, 'WAITER', []).run(ports)).rejects.toMatchObject({
    kind: 'role',
  });
  expect(ports.staff).not.toHaveBeenCalled();
  expect(ports.bind).not.toHaveBeenCalled();
});
it.each([400, 403, 404, 409, 0])(
  'unclassified initial-role %s is never treated as success',
  async (status) => {
    vi.mocked(ports.role).mockRejectedValue(new HttpErrorResponse({ status }));
    await expect(new StaffProvisioningIntent(user, 'WAITER', []).run(ports)).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );
    expect(ports.bind).not.toHaveBeenCalled();
  },
);
it('explicit reactivation uses expectedVersion, skips role mutation and preserves unselected assignments', async () => {
  current = staffFixture(user, { status: 'INACTIVE', version: 2 });
  rows = [
    assignmentFixture('retained'),
    assignmentFixture('selected', { status: 'INACTIVE', version: 4 }),
  ];
  await new StaffProvisioningIntent(user, 'WAITER', ['selected'], 2).run(ports);
  expect(ports.role).not.toHaveBeenCalled();
  expect(ports.reactivate).toHaveBeenCalledWith({
    expectedVersion: 2,
    status: 'ACTIVE',
    clientRequestId: expect.any(String),
  });
  expect(ports.assign).toHaveBeenCalledWith('selected', {
    expectedVersion: 4,
    clientRequestId: expect.any(String),
  });
  expect(rows.find((row) => row.outletId === 'retained')?.status).toBe('ACTIVE');
});
it('stale reactivation must be reviewed rather than overwritten', async () => {
  current = staffFixture(user, { status: 'INACTIVE', version: 3 });
  await expect(new StaffProvisioningIntent(user, 'WAITER', [], 2).run(ports)).rejects.toMatchObject(
    { kind: 'version' },
  );
  expect(ports.reactivate).not.toHaveBeenCalled();
});
it('does not silently reactivate Staff encountered during creation', async () => {
  current = staffFixture(user, { status: 'INACTIVE' });
  await expect(new StaffProvisioningIntent(user, 'WAITER', []).run(ports)).rejects.toMatchObject({
    kind: 'lifecycle',
  });
});
it('incomplete assignment pages require explicit load-more, never an automatic loop', async () => {
  vi.mocked(ports.assignments).mockResolvedValue({ items: [], complete: false });
  await expect(new StaffProvisioningIntent(user, 'WAITER', ['a']).run(ports)).rejects.toMatchObject(
    { kind: 'pages' },
  );
  expect(ports.assignments).toHaveBeenCalledTimes(1);
  expect(ports.assign).not.toHaveBeenCalled();
});
it('assignment duplicate conflict is satisfied only after active canonical readback', async () => {
  vi.mocked(ports.assign).mockImplementation(async (id) => {
    rows.push(assignmentFixture(id));
    throw conflict('RESTAURANTS_STAFF_ASSIGNMENT_EXISTS');
  });
  await new StaffProvisioningIntent(user, 'WAITER', ['a']).run(ports);
  expect(ports.assignments).toHaveBeenCalledTimes(2);
});
it('generic assignment 409 is not success', async () => {
  vi.mocked(ports.assign).mockRejectedValue(new HttpErrorResponse({ status: 409 }));
  await expect(
    new StaffProvisioningIntent(user, 'WAITER', ['a']).run(ports),
  ).rejects.toBeInstanceOf(HttpErrorResponse);
});
it('a duplicate binding is followed by authoritative lifecycle readback', async () => {
  vi.mocked(ports.bind).mockImplementation(async () => {
    current = staffFixture();
    throw conflict('RESTAURANTS_STAFF_EXISTS');
  });
  await new StaffProvisioningIntent(user, 'WAITER', []).run(ports);
  expect(ports.staff).toHaveBeenCalledTimes(3);
});
it('scope/authorization change stops the next operation', async () => {
  let changed = false;
  ports.check = () => {
    if (changed) throw new HttpErrorResponse({ status: 403 });
  };
  vi.mocked(ports.role).mockImplementation(async () => {
    changed = true;
  });
  await expect(new StaffProvisioningIntent(user, 'WAITER', []).run(ports)).rejects.toBeInstanceOf(
    HttpErrorResponse,
  );
  expect(ports.bind).not.toHaveBeenCalled();
});

it('a concurrent reactivation conflict requires canonical review', async () => {
  current = staffFixture(user, { status: 'INACTIVE', version: 2 });
  vi.mocked(ports.reactivate).mockRejectedValue(conflict('RESTAURANTS_WRITE_CONFLICT'));
  await expect(new StaffProvisioningIntent(user, 'WAITER', [], 2).run(ports)).rejects.toMatchObject(
    { kind: 'version' },
  );
  expect(ports.assign).not.toHaveBeenCalled();
});
