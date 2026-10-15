import type { RestaurantStaffOutlet } from '@liass-ohada/shared/restaurants';

export interface StaffAssignmentCommand {
  outletId: string;
  active: boolean;
  request: { clientRequestId: string; expectedVersion?: number };
  done: boolean;
}
/** One explicit editing intent. Preserve payload/UUID after an uncertain or partial result. */
export class StaffAssignmentPlan {
  readonly commands: StaffAssignmentCommand[];
  constructor(
    current: readonly RestaurantStaffOutlet[],
    selected: Record<string, boolean>,
    uuid: () => string = () => crypto.randomUUID(),
  ) {
    const previous = new Map(current.map((row) => [row.outletId, row]));
    this.commands = Object.entries(selected).flatMap(([outletId, active]) => {
      const before = previous.get(outletId);
      return active === (before?.status === 'ACTIVE')
        ? []
        : [
            {
              outletId,
              active,
              done: false,
              request: {
                clientRequestId: uuid(),
                ...(before ? { expectedVersion: before.version } : {}),
              },
            },
          ];
    });
  }
  async run(send: (command: StaffAssignmentCommand) => Promise<unknown>) {
    for (const command of this.commands) {
      if (command.done) continue;
      await send(command);
      command.done = true;
    }
  }
}
