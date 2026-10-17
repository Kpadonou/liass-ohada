import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import {
  RestaurantStaffIdentityService as Identity,
  RestaurantStaffIdentity,
} from "@/lambda/shared/services/restaurant-staff-identity-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantStaffRepository as Staff } from "./staff-repository";
import { RestaurantsRepository } from "./restaurant-repository";
import { restaurantsTableName } from "./restaurant-storage";
import { TransactionScope } from "./transaction-model";

const eligibleRole = (role: string | null | undefined) =>
  ["OWNER", "MANAGER", "WAITER"].includes(role ?? "");
type Presentation = c.GuestSessionRead["responsibleStaff"];
/** Restaurants-owned responsibility policy; Platform owns identities and membership guards. */
export class ResponsibleStaff {
  static async authorize(scope: TransactionScope, actorId: string) {
    await ProductAccessService.requireActiveProductAccess({
      orgId: scope.orgId,
      productCode: "RESTAURANTS",
      action: "REPLACE_RESPONSIBLE_STAFF",
    });
    const actor = await Identity.get(scope.orgId, actorId);
    if (!actor) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    Identity.writeChecks(scope.orgId, actor);
    return actor;
  }
  /** Four bounded batch reads plus fixed entitlement/outlet reads, independent of page size. */
  static async read(scope: TransactionScope, userIds: string[]) {
    const ids = [...new Set(userIds)];
    const result = new Map<string, NonNullable<Presentation>>();
    if (!ids.length) return result;
    const [staff, assignments, identities, product, outlet] = await Promise.all(
      [
        Staff.batch(
          scope.orgId,
          ids.map((id) => Staff.staffKey(scope.orgId, id)),
          "STAFF",
        ),
        Staff.batch(
          scope.orgId,
          ids.map(
            (id) => Staff.assignmentKeys(scope.orgId, id, scope.outletId)[0],
          ),
          "ASSIGNMENT",
        ),
        Identity.batch(scope.orgId, ids),
        ProductAccessService.getProductAccess(scope.orgId, "RESTAURANTS"),
        RestaurantsRepository.get(scope.orgId, "outlet", {}, scope.outletId),
      ],
    );
    ids.forEach((id, index) => {
      const identity = identities.get(id);
      result.set(
        id,
        c.ResponsibleRestaurantStaffSchema.parse({
          staffId: id,
          displayName:
            staff[index]?.operationalLabel ?? identity?.displayName ?? null,
          available:
            staff[index]?.status === "ACTIVE" &&
            assignments[index]?.status === "ACTIVE" &&
            identity?.active === true &&
            eligibleRole(identity.restaurantRole) &&
            product?.status === "ACTIVE" &&
            outlet?.data.isActive === true,
        }),
      );
    });
    return result;
  }
  static async sessions(
    scope: TransactionScope,
    sessions: c.GuestSession[],
  ): Promise<c.GuestSessionRead[]> {
    const people = await this.read(
      scope,
      sessions.flatMap((s) =>
        s.responsibleStaffId ? [s.responsibleStaffId] : [],
      ),
    );
    return sessions.map(({ responsibleStaffId, ...session }) =>
      c.GuestSessionReadSchema.parse({
        ...session,
        ...(responsibleStaffId
          ? { responsibleStaff: people.get(responsibleStaffId) }
          : {}),
      }),
    );
  }
  static async checks(
    scope: TransactionScope,
    actor: RestaurantStaffIdentity,
    userId: string | null,
  ): Promise<TransactWriteItem[]> {
    if (userId === null) return Identity.writeChecks(scope.orgId, actor);
    const { conditions, subject } = await this.candidate(scope, userId);
    return [
      ...Identity.writeChecks(scope.orgId, actor, subject),
      ...conditions,
    ];
  }
  static async selfChecks(
    scope: TransactionScope,
    actor: RestaurantStaffIdentity,
    preparation = false,
  ) {
    if (
      actor.restaurantRole !== "WAITER" &&
      !(preparation && actor.restaurantRole === "KITCHEN")
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const candidate = await this.candidate(
      scope,
      actor.userId,
      actor,
      preparation,
    );
    return {
      displayName: candidate.displayName,
      actions: [
        ...Identity.serviceChecks(scope.orgId, actor, preparation),
        ...candidate.conditions,
      ],
    };
  }
  private static async candidate(
    scope: TransactionScope,
    userId: string,
    knownIdentity?: RestaurantStaffIdentity,
    preparation = false,
  ) {
    const [staff, assignment, subject] = await Promise.all([
      Staff.get(scope.orgId, Staff.staffKey(scope.orgId, userId), "STAFF"),
      Staff.get(
        scope.orgId,
        Staff.assignmentKeys(scope.orgId, userId, scope.outletId)[0],
        "ASSIGNMENT",
      ),
      knownIdentity ?? Identity.get(scope.orgId, userId),
    ]);
    if (
      !staff ||
      staff.status !== "ACTIVE" ||
      !assignment ||
      assignment.status !== "ACTIVE" ||
      !subject?.active ||
      !(
        eligibleRole(subject.restaurantRole) ||
        (preparation && subject.restaurantRole === "KITCHEN")
      )
    )
      throw new AppError(409, "RESTAURANTS_RESPONSIBLE_STAFF_INELIGIBLE");
    return {
      subject,
      displayName: staff.operationalLabel ?? subject.displayName,
      conditions: [
        ...[
          {
            key: Staff.staffKey(scope.orgId, userId),
            version: staff.version,
            type: "RESTAURANT_STAFF",
          },
          {
            key: Staff.assignmentKeys(scope.orgId, userId, scope.outletId)[0],
            version: assignment.version,
            type: "RESTAURANT_STAFF_ASSIGNMENT",
          },
        ].map(
          ({ key, version, type }): TransactWriteItem => ({
            ConditionCheck: {
              TableName: restaurantsTableName(),
              Key: marshall(key),
              ConditionExpression:
                "entityType = :type AND orgId = :org AND #data.#version = :version AND #data.#status = :active",
              ExpressionAttributeNames: {
                "#data": "data",
                "#version": "version",
                "#status": "status",
              },
              ExpressionAttributeValues: marshall({
                ":type": type,
                ":org": scope.orgId,
                ":version": version,
                ":active": "ACTIVE",
              }),
            },
          }),
        ),
      ],
    };
  }
}
