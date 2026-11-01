import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RESTAURANT_REFUND_ROUTES } from "./refund-routes";
import { RestaurantRefundService as S } from "./refund-service";
export function restaurantRefundHandler(
  route: (typeof RESTAURANT_REFUND_ROUTES)[number],
) {
  const fields = Object.fromEntries(
    [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => [
      m[1],
      c.RestaurantIdSchema,
    ]),
  );
  return createHandler(
    z.object(fields).passthrough(),
    async (_, context) => {
      const paths = z
        .object(fields)
        .strict()
        .parse(context.event.pathParameters);
      const scope = { orgId: context.orgId, outletId: paths.outletId };
      if (route.operation === "CREATE")
        return S.create(
          scope,
          context.userId,
          paths.creditNoteId,
          context.event.body ? JSON.parse(context.event.body) : {},
        );
      if (route.operation === "LIST")
        return S.list(
          scope,
          context.userId,
          paths.creditNoteId,
          context.event.queryStringParameters ?? {},
        );
      return S.detail(scope, context.userId, paths.refundId);
    },
    {
      productCode: "RESTAURANTS",
      permission:
        route.operation === "CREATE"
          ? "RESTAURANTS_SETUP_MANAGE"
          : "RESTAURANTS_CHECKOUT_READ",
      action: `REFUND_${route.operation}`,
    },
  );
}
