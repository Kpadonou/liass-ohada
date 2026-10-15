import { HttpErrorResponse } from '@angular/common/http';
import type { RestaurantStaff, RestaurantStaffOutlet } from '@liass-ohada/shared/restaurants';
import type { AssignInitialProductRoleRequest } from '@liass-ohada/shared/shared';
export type InitialStaffRole = AssignInitialProductRoleRequest['role'];
export function provisioningCode(error: unknown): string | undefined {
  return error instanceof HttpErrorResponse ? error.error?.error?.code : undefined;
}
export class StaffProvisioningIssue extends Error {
  constructor(readonly kind: 'role' | 'lifecycle' | 'pages' | 'version') {
    super(kind);
  }
}
export interface ProvisioningPorts {
  check(): void;
  role(request: { clientRequestId: string; role: InitialStaffRole }): Promise<unknown>;
  staff(): Promise<RestaurantStaff | null>;
  bind(request: { clientRequestId: string; memberUserId: string }): Promise<RestaurantStaff>;
  reactivate(request: {
    clientRequestId: string;
    expectedVersion: number;
    status: 'ACTIVE';
  }): Promise<RestaurantStaff>;
  assignments(): Promise<{ items: RestaurantStaffOutlet[]; complete: boolean }>;
  assign(
    outletId: string,
    request: { clientRequestId: string; expectedVersion?: number },
  ): Promise<unknown>;
}
/** Local immutable command intent/IDs only. Authoritative entities stay in Query caches. */
export class StaffProvisioningIntent {
  private readonly roleId = crypto.randomUUID();
  private readonly bindId = crypto.randomUUID();
  private readonly activationId = crypto.randomUUID();
  private readonly outletCommands = new Map<
    string,
    { clientRequestId: string; expectedVersion?: number }
  >();
  constructor(
    readonly userId: string,
    readonly role: InitialStaffRole | 'OWNER',
    readonly outlets: readonly string[],
    readonly activationVersion?: number,
  ) {}
  async run(ports: ProvisioningPorts) {
    const execute = async <T>(action: () => Promise<T>) => {
      ports.check();
      const result = await action();
      ports.check();
      return result;
    };
    if (this.activationVersion === undefined) {
      if (this.role === 'OWNER') throw new StaffProvisioningIssue('role');
      try {
        await execute(() =>
          ports.role({ clientRequestId: this.roleId, role: this.role as InitialStaffRole }),
        );
      } catch (error) {
        if (provisioningCode(error) === 'PLATFORM_PRODUCT_ROLE_CONFLICT')
          throw new StaffProvisioningIssue('role');
        throw error;
      }
    }
    let staff = await execute(() => ports.staff());
    if (!staff) {
      if (this.activationVersion !== undefined) throw new StaffProvisioningIssue('lifecycle');
      try {
        staff = await execute(() =>
          ports.bind({ clientRequestId: this.bindId, memberUserId: this.userId }),
        );
      } catch (error) {
        if (
          !['RESTAURANTS_STAFF_EXISTS', 'RESTAURANTS_WRITE_CONFLICT'].includes(
            provisioningCode(error) ?? '',
          )
        )
          throw error;
        staff = await execute(() => ports.staff());
        if (!staff) throw error;
      }
      // Durable replay can return an old snapshot. Read current lifecycle before continuing.
      staff = await execute(() => ports.staff());
    }
    if (!staff?.organizationMembershipActive || staff.restaurantRole !== this.role)
      throw new StaffProvisioningIssue('role');
    if (staff.status === 'INACTIVE') {
      if (this.activationVersion === undefined) throw new StaffProvisioningIssue('lifecycle');
      if (staff.version !== this.activationVersion) throw new StaffProvisioningIssue('version');
      try {
        await execute(() =>
          ports.reactivate({
            clientRequestId: this.activationId,
            expectedVersion: this.activationVersion!,
            status: 'ACTIVE',
          }),
        );
      } catch (error) {
        if (provisioningCode(error) === 'RESTAURANTS_WRITE_CONFLICT')
          throw new StaffProvisioningIssue('version');
        throw error;
      }
      staff = await execute(() => ports.staff());
      if (!staff || staff.status !== 'ACTIVE') throw new StaffProvisioningIssue('lifecycle');
    }
    if (!this.outlets.length) return;
    let assignments = await execute(() => ports.assignments());
    if (!assignments.complete) throw new StaffProvisioningIssue('pages');
    for (const outletId of this.outlets) {
      const before = assignments.items.find((row) => row.outletId === outletId);
      if (before?.status === 'ACTIVE') continue;
      let command = this.outletCommands.get(outletId);
      if (command && command.expectedVersion !== before?.version)
        throw new StaffProvisioningIssue('version');
      if (!command) {
        command = {
          clientRequestId: crypto.randomUUID(),
          ...(before ? { expectedVersion: before.version } : {}),
        };
        this.outletCommands.set(outletId, command);
      }
      try {
        await execute(() => ports.assign(outletId, command!));
      } catch (error) {
        if (
          !['RESTAURANTS_STAFF_ASSIGNMENT_EXISTS', 'RESTAURANTS_WRITE_CONFLICT'].includes(
            provisioningCode(error) ?? '',
          )
        )
          throw error;
        assignments = await execute(() => ports.assignments());
        if (!assignments.complete) throw new StaffProvisioningIssue('pages');
        if (!assignments.items.some((row) => row.outletId === outletId && row.status === 'ACTIVE'))
          throw new StaffProvisioningIssue('version');
      }
    }
  }
}
