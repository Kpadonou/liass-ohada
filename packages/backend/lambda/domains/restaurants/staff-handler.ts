import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RESTAURANT_STAFF_ROUTES, RestaurantStaffRoute } from "./staff-routes";
import {
  RestaurantStaffService as S,
  staffCommandSchemas,
} from "./staff-service";

export function restaurantStaffHandler(name: string) {
  const route: RestaurantStaffRoute | undefined = RESTAURANT_STAFF_ROUTES.find(
    (candidate) => candidate.name === name,
  );
  if (!route) throw new Error("Unknown Restaurants staff route");
  const command = route.command;
  const query = route.query;
  const paths: Record<string, z.ZodString> = {};
  if (route.path.includes("{memberUserId}"))
    paths.memberUserId = c.RestaurantStaffUserIdSchema;
  if (route.path.includes("{outletId}")) paths.outletId = c.RestaurantIdSchema;
  const fields = command
    ? staffCommandSchemas[command].shape
    : query === "GET"
      ? {}
      : c.RestaurantsListRequestSchema.shape;
  return createHandler(
    z.object({ ...fields, ...paths }).strict(),
    async (request, context) => {
      const input: Record<string, unknown> = { ...request };
      const userId =
        input.memberUserId === undefined
          ? undefined
          : c.RestaurantStaffUserIdSchema.parse(input.memberUserId);
      const outletId =
        input.outletId === undefined
          ? undefined
          : c.RestaurantIdSchema.parse(input.outletId);
      for (const field of Object.keys(paths)) delete input[field];
      if (command) {
        const target = c.RestaurantStaffUserIdSchema.parse(userId);
        const record = await S.mutate(
          context.orgId,
          context.userId,
          target,
          command,
          input,
          outletId,
        );
        return "outletId" in record
          ? c.RestaurantStaffOutletResponseSchema.parse({ data: record })
          : c.RestaurantStaffResponseSchema.parse({
              data: await S.dto(context.orgId, record),
            });
      }
      if (query === "LIST") return S.list(context.orgId, input);
      if (query === "GET")
        return c.RestaurantStaffResponseSchema.parse({
          data: await S.dto(context.orgId, await S.get(context.orgId, userId!)),
        });
      if (query === "STAFF_OUTLETS")
        return S.staffOutlets(context.orgId, userId!, input);
      return S.outletStaff(context.orgId, outletId!, input);
    },
    {
      productCode: "RESTAURANTS",
      permission: route.permission,
      action: route.name,
    },
  );
}
