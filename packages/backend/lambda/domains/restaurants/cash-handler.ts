import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RestaurantCashService as S, cashCommands } from "./cash-service";
import { RESTAURANT_CASH_ROUTES } from "./cash-routes";
const querySchemas = {
  CURRENT_DAY: c.RestaurantCurrentBusinessDayResponseSchema,
  DAY: c.RestaurantBusinessDayResponseSchema,
  DAYS: c.RestaurantBusinessDayListResponseSchema,
  SUMMARY_DAY: c.RestaurantBusinessDaySummaryResponseSchema,
  SESSIONS: c.RestaurantCashSessionListResponseSchema,
  CURRENT_CASH: c.RestaurantCurrentCashSessionResponseSchema,
  CASH: c.RestaurantCashSessionResponseSchema,
  SUMMARY_CASH: c.RestaurantCashSessionSummaryResponseSchema,
  MOVEMENTS: c.RestaurantCashMovementListResponseSchema,
};
export function restaurantCashHandler(
  route: (typeof RESTAURANT_CASH_ROUTES)[number],
) {
  const pathFields = Object.fromEntries(
    [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => [
      m[1],
      c.RestaurantIdSchema,
    ]),
  );
  const list =
    "query" in route && ["DAYS", "SESSIONS", "MOVEMENTS"].includes(route.query);
  const bodySchema =
    "command" in route ? cashCommands[route.command] : z.object({}).strict();
  const querySchema = list
    ? c.RestaurantCashListRequestSchema
    : z.object({}).strict();
  return createHandler(
    z
      .object({ ...bodySchema.shape, ...querySchema.shape, ...pathFields })
      .strict(),
    async (raw, context) => {
      // Validate transport sources separately so a body/query can never override a route identity.
      const event = context.event;
      const body = bodySchema.parse(event.body ? JSON.parse(event.body) : {});
      const query = querySchema.parse(event.queryStringParameters ?? {});
      const outletId = c.RestaurantIdSchema.parse(raw.outletId);
      const target = route.path.includes("{businessDayId}")
        ? c.RestaurantIdSchema.parse(raw.businessDayId)
        : route.path.includes("{cashSessionId}")
          ? c.RestaurantIdSchema.parse(raw.cashSessionId)
          : undefined;
      if ("command" in route) {
        const result = await S.mutate(
          { orgId: context.orgId, outletId },
          context.userId,
          route.command,
          body,
          target,
        );
        const schema =
          route.command === "OPEN_DAY" || route.command === "CLOSE_DAY"
            ? c.RestaurantBusinessDayResponseSchema
            : route.command === "MOVEMENT"
              ? c.RestaurantCashMovementResponseSchema
              : c.RestaurantCashSessionResponseSchema;
        return schema.parse(result);
      }
      return querySchemas[route.query].parse(
        await S.query(
          { orgId: context.orgId, outletId },
          context.userId,
          route.query,
          query,
          target,
        ),
      );
    },
    {
      productCode: "RESTAURANTS",
      permission: route.permission,
      action: "command" in route ? route.command : route.query,
    },
  );
}
