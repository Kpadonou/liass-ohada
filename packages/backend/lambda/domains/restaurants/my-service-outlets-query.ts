import * as c from "@liass-ohada/shared/restaurants";
import { RestaurantStaffIdentityService as Identity } from "@/lambda/shared/services/restaurant-staff-identity-service";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantStaffRepository as Staff } from "./staff-repository";
import { RestaurantsRepository as Config } from "./restaurant-repository";

export class MyRestaurantOutlets {
  /** Called after verified membership/ProductAccess; scope is never accepted from the request. */
  static async read(orgId: string, actorId: string, request: unknown) {
    const input = c.RestaurantsListRequestSchema.parse(request);
    const actor = await Identity.get(orgId, actorId);
    if (!actor) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    Identity.serviceChecks(orgId, actor);
    const staff = await Staff.get(
      orgId,
      Staff.staffKey(orgId, actorId),
      "STAFF",
    );
    if (staff?.status !== "ACTIVE")
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const page = await Staff.list(
      orgId,
      { userId: actorId },
      "ASSIGNMENT",
      input,
    );
    const ids = page.items
      .filter((item) => item.status === "ACTIVE")
      .map((item) => item.outletId);
    return c.RestaurantMyOutletsResponseSchema.parse({
      items: await Config.staffOutlets(orgId, ids),
      nextCursor: page.nextCursor,
    });
  }
}
