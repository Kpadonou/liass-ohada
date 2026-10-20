import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RestaurantReceiptService as S } from "./receipt-service";
import { RESTAURANT_RECEIPT_ROUTES } from "./receipt-routes";
export function restaurantReceiptHandler(
  name: "publish-receipt" | "get-receipt",
) {
  const route = RESTAURANT_RECEIPT_ROUTES.find((r) => r.name === name)!;
  return createHandler(
    z
      .object({
        ...(name === "publish-receipt"
          ? c.PublishRestaurantReceiptRequestSchema.shape
          : c.RestaurantReceiptReadRequestSchema.shape),
        outletId: c.RestaurantIdSchema,
        sessionId: c.RestaurantIdSchema,
      })
      .strict(),
    async ({ outletId, sessionId, ...input }, context) => {
      const scope = { orgId: context.orgId, outletId };
      return name === "publish-receipt"
        ? c.RestaurantReceiptPublicationResponseSchema.parse(
            await S.publish(scope, context.userId, sessionId, input),
          )
        : S.read(scope, context.userId, sessionId, input);
    },
    {
      permission: route.permission,
      productCode: "RESTAURANTS",
      action: route.receipt,
    },
  );
}
