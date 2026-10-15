import { randomUUID } from "crypto";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  RestaurantStaffIdentityService as Identity,
  RestaurantStaffIdentity,
} from "@/lambda/shared/services/restaurant-staff-identity-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { StaffRecord, StaffRecordSchema } from "./staff-model";
import { RestaurantStaffRepository as R } from "./staff-repository";
import { RestaurantsRepository } from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";
import { transactionFingerprint } from "./transaction-repository";

export const staffCommandSchemas = {
  BIND: c.BindRestaurantStaffRequestSchema,
  UPDATE: c.UpdateRestaurantStaffRequestSchema,
  ASSIGN: c.AssignRestaurantStaffOutletRequestSchema,
  UNASSIGN: c.UnassignRestaurantStaffOutletRequestSchema,
};
export type StaffCommand = keyof typeof staffCommandSchemas;
const fail = (
  code = "RESTAURANTS_STAFF_MEMBER_REQUIRED",
  status = 403,
): never => {
  throw new AppError(status, code);
};
export class RestaurantStaffService {
  static async dto(orgId: string, record: StaffRecord) {
    const identity = await Identity.get(orgId, record.userId);
    return c.RestaurantStaffSchema.parse({
      ...record,
      displayName: record.operationalLabel ?? identity?.displayName ?? null,
      restaurantRole: identity?.restaurantRole ?? null,
      organizationMembershipActive: identity?.active ?? false,
    });
  }
  static async get(orgId: string, userId: string) {
    c.RestaurantStaffUserIdSchema.parse(userId);
    const row = await R.get(orgId, R.staffKey(orgId, userId), "STAFF");
    if (!row) return fail("RESTAURANTS_STAFF_NOT_FOUND", 404);
    return row;
  }
  static async list(orgId: string, input: unknown) {
    const page = await R.list(
      orgId,
      {},
      "STAFF",
      c.RestaurantsListRequestSchema.parse(input),
    );
    return c.RestaurantStaffListResponseSchema.parse({
      ...page,
      items: await Promise.all(page.items.map((row) => this.dto(orgId, row))),
    });
  }
  static async staffOutlets(orgId: string, userId: string, input: unknown) {
    await this.get(orgId, userId);
    return c.RestaurantStaffOutletListResponseSchema.parse(
      await R.list(
        orgId,
        { userId },
        "ASSIGNMENT",
        c.RestaurantsListRequestSchema.parse(input),
      ),
    );
  }
  static async outletStaff(orgId: string, outletId: string, input: unknown) {
    c.RestaurantIdSchema.parse(outletId);
    if (!(await RestaurantsRepository.get(orgId, "outlet", {}, outletId)))
      return fail("RESTAURANTS_PARENT_NOT_FOUND", 404);
    const page = await R.list(
      orgId,
      { outletId },
      "ASSIGNMENT",
      c.RestaurantsListRequestSchema.parse(input),
    );
    return c.RestaurantOutletStaffListResponseSchema.parse({
      ...page,
      items: await Promise.all(
        page.items.map(async (assignment) => ({
          assignment,
          staff: await this.dto(
            orgId,
            await this.get(orgId, assignment.userId),
          ),
        })),
      ),
    });
  }
  /** Prerequisite only: never grants a transaction permission. Fixed number of direct reads. */
  static async isActivelyAssigned(
    orgId: string,
    userId: string,
    outletId: string,
  ): Promise<boolean> {
    c.RestaurantStaffUserIdSchema.parse(userId);
    c.RestaurantIdSchema.parse(outletId);
    const product = await ProductAccessService.getProductAccess(
      orgId,
      "RESTAURANTS",
    );
    if (product?.status !== "ACTIVE") return false;
    const identity = await Identity.get(orgId, userId);
    if (!identity?.active || !identity.restaurantRole) return false;
    const [staff, assignment, outlet] = await Promise.all([
      R.get(orgId, R.staffKey(orgId, userId), "STAFF"),
      R.get(orgId, R.assignmentKeys(orgId, userId, outletId)[0], "ASSIGNMENT"),
      RestaurantsRepository.get(orgId, "outlet", {}, outletId),
    ]);
    return (
      staff?.status === "ACTIVE" &&
      assignment?.status === "ACTIVE" &&
      outlet?.data.isActive === true
    );
  }
  static async mutate(
    orgId: string,
    actorId: string,
    userId: string,
    command: StaffCommand,
    input: unknown,
    outletId?: string,
  ) {
    c.RestaurantStaffUserIdSchema.parse(userId);
    c.RestaurantStaffUserIdSchema.parse(actorId);
    const request = staffCommandSchemas[command].parse(input);
    if (
      command === "BIND" &&
      "memberUserId" in request &&
      request.memberUserId !== userId
    )
      return fail();
    if (command === "ASSIGN" || command === "UNASSIGN")
      c.RestaurantIdSchema.parse(outletId);
    else if (outletId !== undefined) return fail();
    const actor = await Identity.get(orgId, actorId);
    if (!actor) return fail();
    // Also enforce security for direct service callers; handlers enforce the canonical metadata chain.
    await ProductAccessService.requireActiveProductAccess({
      orgId,
      productCode: "RESTAURANTS",
      action: command,
    });
    const checks = Identity.writeChecks(orgId, actor);
    const provisioning =
      command === "BIND" ||
      command === "ASSIGN" ||
      (command === "UPDATE" &&
        "status" in request &&
        request.status === "ACTIVE");
    const organizationChecks = provisioning
      ? await Identity.staffProvisioningChecks(orgId)
      : [];
    const pk = K.restaurantStaffHistoryPK(orgId, userId);
    const commandKey = {
      PK: pk,
      SK: K.restaurantStaffCommandSK(request.clientRequestId),
    };
    const fingerprint = transactionFingerprint([
      actorId,
      userId,
      outletId,
      command,
      request,
    ]);
    const replay = async () => {
      const prior = await R.get(orgId, commandKey, "COMMAND");
      if (!prior) return undefined;
      if (prior.fingerprint !== fingerprint)
        return fail("RESTAURANTS_IDEMPOTENCY_CONFLICT", 409);
      return prior.result;
    };
    const prior = await replay();
    if (prior) return prior;
    const existing = await R.get(orgId, R.staffKey(orgId, userId), "STAFF");
    const now = new Date().toISOString();
    let before: StaffRecord | c.RestaurantStaffOutlet | undefined;
    let after: StaffRecord | c.RestaurantStaffOutlet;
    const actions: TransactWriteItem[] = [];
    const assertSubject = async (): Promise<RestaurantStaffIdentity> => {
      const identity = await Identity.get(orgId, userId);
      if (!identity?.active || !identity.restaurantRole) return fail();
      checks.splice(
        0,
        checks.length,
        ...Identity.writeChecks(orgId, actor, identity),
      );
      return identity;
    };
    if (command === "BIND") {
      if (existing) return fail("RESTAURANTS_STAFF_EXISTS", 409);
      const identity = await assertSubject();
      const binding = c.BindRestaurantStaffRequestSchema.parse(request);
      if (!binding.operationalLabel && !identity.displayName)
        return fail("RESTAURANTS_STAFF_LABEL_REQUIRED", 400);
      if (binding.operationalLabel === userId)
        return fail("RESTAURANTS_STAFF_LABEL_REQUIRED", 400);
      after = StaffRecordSchema.parse({
        userId,
        operationalLabel: binding.operationalLabel,
        status: "ACTIVE",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      actions.push(R.put(orgId, R.staffKey(orgId, userId), "STAFF", after));
    } else {
      if (!existing) return fail("RESTAURANTS_STAFF_NOT_FOUND", 404);
      if (command === "UPDATE") {
        const update = c.UpdateRestaurantStaffRequestSchema.parse(request);
        if (existing.version !== update.expectedVersion)
          return fail("RESTAURANTS_WRITE_CONFLICT", 409);
        before = existing;
        const identity =
          update.status === "INACTIVE"
            ? await Identity.get(orgId, userId)
            : await assertSubject();
        const label =
          update.operationalLabel === null
            ? undefined
            : (update.operationalLabel ?? existing.operationalLabel);
        if (
          (update.operationalLabel !== undefined ||
            update.status === "ACTIVE") &&
          ((!label && !identity?.displayName) || label === userId)
        )
          return fail("RESTAURANTS_STAFF_LABEL_REQUIRED", 400);
        after = StaffRecordSchema.parse({
          ...existing,
          operationalLabel: label,
          status: update.status ?? existing.status,
          version: existing.version + 1,
          updatedAt: now,
        });
        actions.push(
          R.put(
            orgId,
            R.staffKey(orgId, userId),
            "STAFF",
            after,
            existing.version,
          ),
        );
      } else {
        const targetOutlet = c.RestaurantIdSchema.parse(outletId);
        const outlet = await RestaurantsRepository.get(
          orgId,
          "outlet",
          {},
          targetOutlet,
        );
        if (!outlet) return fail("RESTAURANTS_PARENT_NOT_FOUND", 404);
        const keys = R.assignmentKeys(orgId, userId, targetOutlet);
        before = await R.get(orgId, keys[0], "ASSIGNMENT");
        const version =
          "expectedVersion" in request ? request.expectedVersion : undefined;
        if (command === "ASSIGN") {
          await assertSubject();
          if (existing.status !== "ACTIVE")
            return fail("RESTAURANTS_STAFF_INACTIVE", 409);
          if (!outlet.data.isActive)
            return fail("RESTAURANTS_PARENT_INACTIVE", 409);
          if (before?.status === "ACTIVE")
            return fail("RESTAURANTS_STAFF_ASSIGNMENT_EXISTS", 409);
        } else if (!before || before.status !== "ACTIVE")
          return fail("RESTAURANTS_STAFF_ASSIGNMENT_NOT_FOUND", 404);
        if (before ? before.version !== version : version !== undefined)
          return fail("RESTAURANTS_WRITE_CONFLICT", 409);
        after = c.RestaurantStaffOutletSchema.parse({
          userId,
          outletId: targetOutlet,
          status: command === "ASSIGN" ? "ACTIVE" : "INACTIVE",
          version: (before?.version ?? 0) + 1,
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        });
        actions.push(
          ...keys.map((key) =>
            R.put(
              orgId,
              key,
              "ASSIGNMENT",
              after as c.RestaurantStaffOutlet,
              before?.version,
            ),
          ),
        );
        // Concurrent staff deactivation and outlet changes cannot race a new assignment.
        actions.push({
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall(R.staffKey(orgId, userId)),
            ConditionExpression:
              "entityType = :type AND orgId = :org AND #data.#version = :version",
            ExpressionAttributeNames: {
              "#data": "data",
              "#version": "version",
            },
            ExpressionAttributeValues: marshall({
              ":type": "RESTAURANT_STAFF",
              ":org": orgId,
              ":version": existing.version,
            }),
          },
        });
        actions.push({
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall({
              PK: K.orgKey(orgId),
              SK: K.restaurantOutletSK(targetOutlet),
            }),
            ConditionExpression:
              "entityType = :type AND orgId = :org AND #data.#version = :version",
            ExpressionAttributeNames: {
              "#data": "data",
              "#version": "version",
            },
            ExpressionAttributeValues: marshall({
              ":type": "RESTAURANT_OUTLET",
              ":org": orgId,
              ":version": outlet.data.version,
            }),
          },
        });
      }
    }
    actions.push(
      ...checks,
      ...organizationChecks,
      R.put(orgId, commandKey, "COMMAND", { fingerprint, result: after }),
      R.put(
        orgId,
        { PK: pk, SK: K.restaurantTransactionAuditSK(now, randomUUID()) },
        "AUDIT",
        {
          actorId,
          userId,
          outletId,
          action: command,
          timestamp: now,
          before: before ?? null,
          after,
        },
      ),
    );
    try {
      await R.commit(actions);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.messageCode === "RESTAURANTS_WRITE_CONFLICT"
      ) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
      }
      throw error;
    }
    return after;
  }
}
