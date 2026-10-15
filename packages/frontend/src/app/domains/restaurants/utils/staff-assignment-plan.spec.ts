import { StaffAssignmentPlan } from './staff-assignment-plan';
import { assignmentFixture } from '../data-access/staff.test-fixture';
import { rid } from '../data-access/restaurants.test-fixture';
describe('Staff assignment delta and explicit retries', () => {
  it('keeps unchanged and unloaded references, versions removal and retained reactivation', () => {
    const plan = new StaffAssignmentPlan(
      [
        assignmentFixture(rid(2)),
        assignmentFixture(rid(3), { status: 'INACTIVE', version: 4 }),
        assignmentFixture(rid(9)),
      ],
      { [rid(2)]: false, [rid(3)]: true, [rid(4)]: true },
      () => 'fixed',
    );
    expect(plan.commands).toEqual([
      {
        outletId: rid(2),
        active: false,
        done: false,
        request: { clientRequestId: 'fixed', expectedVersion: 1 },
      },
      {
        outletId: rid(3),
        active: true,
        done: false,
        request: { clientRequestId: 'fixed', expectedVersion: 4 },
      },
      { outletId: rid(4), active: true, done: false, request: { clientRequestId: 'fixed' } },
    ]);
  });
  it('does not create commands for unchanged active/inactive checkboxes', () => {
    expect(
      new StaffAssignmentPlan([assignmentFixture()], { [rid(2)]: true, [rid(3)]: false }).commands,
    ).toEqual([]);
  });
  it('stops on partial failure, then resumes only unresolved commands with identical UUIDs/payloads', async () => {
    const plan = new StaffAssignmentPlan([], { [rid(2)]: true, [rid(3)]: true, [rid(4)]: true });
    const original = structuredClone(plan.commands);
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('network'));
    await expect(plan.run(send)).rejects.toThrow('network');
    expect(send).toHaveBeenCalledTimes(2);
    expect(plan.commands.map((c) => c.done)).toEqual([true, false, false]);
    send.mockResolvedValue({});
    await plan.run(send);
    expect(send.mock.calls.slice(2).map(([command]) => command.request)).toEqual(
      original.slice(1).map((command) => command.request),
    );
    expect(plan.commands.every((command) => command.done)).toBe(true);
    await plan.run(send);
    expect(send).toHaveBeenCalledTimes(4);
  });
});
