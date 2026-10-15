import type { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { AppError } from "@/lambda/shared/app-error";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { RestaurantStaffIdentityService as Identity } from "@/lambda/shared/services/restaurant-staff-identity-service";
import { ResponsibleStaff } from "./responsible-staff";
import { TransactionScope } from "./transaction-model";
import { RestaurantsRepository } from "./restaurant-repository";

/** Product grants alone never establish operational outlet access. */
export class RestaurantServiceAccess {
  static async authorize(
    scope: TransactionScope,
    actorId: string,
  ): Promise<{
    actions: TransactWriteItem[];
    staffId?: string;
    displayName?: string | null;
  }> {
    await ProductAccessService.requireActiveProductAccess({
      orgId: scope.orgId,
      productCode: "RESTAURANTS",
      action: "SERVICE_ACCESS",
    });
    const actor = await Identity.get(scope.orgId, actorId);
    if (!actor) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const actions = Identity.serviceChecks(scope.orgId, actor);
    if (actor.restaurantRole !== "WAITER") return { actions };
    try {
      const self = await ResponsibleStaff.selfChecks(scope, actor);
      const outlet = await RestaurantsRepository.get(
        scope.orgId,
        "outlet",
        {},
        scope.outletId,
      );
      if (!outlet?.data.isActive)
        throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
      return { ...self, staffId: actor.userId };
    } catch (error) {
      if (
        error instanceof AppError &&
        error.messageCode === "RESTAURANTS_RESPONSIBLE_STAFF_INELIGIBLE"
      )
        throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
      throw error;
    }
  }
}
