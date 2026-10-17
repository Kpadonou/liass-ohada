import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RESTAURANT_PREPARATION_ROUTES } from "./preparation-routes";
import { RestaurantPreparationService as S } from "./preparation-service";
export function restaurantPreparationHandler(name: string) {
  const route = RESTAURANT_PREPARATION_ROUTES.find((r) => r.name === name);
  if (!route) throw new Error("Unknown preparation route");
  const fields: Record<string, z.ZodType> = {};
  for (const match of route.path.matchAll(/\{(\w+)\}/g))
    fields[match[1]] =
      match[1] === "state" ? c.PreparationLaneSchema : c.RestaurantIdSchema;
  return createHandler(
    z
      .object({
        ...fields,
        ...(route.method === "GET"
          ? c.RestaurantTransactionListRequestSchema.shape
          : c.PreparationTransitionRequestSchema.shape),
      })
      .strict(),
    async (request, context) => {
      const { outletId, stationId, state, orderId, itemId, fireId, ...input } =
        request;
      const scope = {
        orgId: context.orgId,
        outletId: c.RestaurantIdSchema.parse(outletId),
      };
      if (route.preparation === "LANE" || route.preparation === "ORDER")
        return S.read(scope, context.userId, input, {
          stationId: stationId as string,
          state: state as string,
          orderId: orderId as string,
        });
      return S.transition(scope, context.userId, route.preparation, input, {
        orderId: c.RestaurantIdSchema.parse(orderId),
        itemId: c.RestaurantIdSchema.parse(itemId),
        fireId: c.RestaurantIdSchema.parse(fireId),
      });
    },
    {
      permission: route.permission,
      productCode: "RESTAURANTS",
      action: route.name,
    },
  );
}
