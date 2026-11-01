import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RESTAURANT_CREDIT_NOTE_ROUTES } from "./credit-note-routes";
import { RestaurantCreditNoteService as S } from "./credit-note-service";
export function restaurantCreditNoteHandler(
  route: (typeof RESTAURANT_CREDIT_NOTE_ROUTES)[number],
) {
  const bodySchema =
    route.operation === "CREATE"
      ? c.CreateRestaurantCreditNoteRequestSchema
      : z.object({}).strict();
  const querySchema =
    route.operation === "LIST"
      ? c.RestaurantCreditNoteListRequestSchema
      : z.object({}).strict();
  const fields = Object.fromEntries(
    [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => [
      m[1],
      c.RestaurantIdSchema,
    ]),
  );
  return createHandler(
    z.object({ ...fields }).passthrough(),
    async (_, context) => {
      const paths = z
        .object(fields)
        .strict()
        .parse(context.event.pathParameters);
      const rawBody = context.event.body ? JSON.parse(context.event.body) : {};
      const body =
        route.operation === "CREATE" ? rawBody : bodySchema.parse(rawBody);
      const query = querySchema.parse(
        context.event.queryStringParameters ?? {},
      );
      const scope = { orgId: context.orgId, outletId: paths.outletId };
      if (route.operation === "CREATE")
        return S.create(scope, context.userId, paths.guestSessionId, body);
      if (route.operation === "LIST")
        return S.list(scope, context.userId, paths.guestSessionId, query);
      return S.detail(scope, context.userId, paths.creditNoteId);
    },
    {
      productCode: "RESTAURANTS",
      permission:
        route.operation === "CREATE"
          ? "RESTAURANTS_SETUP_MANAGE"
          : "RESTAURANTS_CHECKOUT_READ",
      action: `CREDIT_NOTE_${route.operation}`,
    },
  );
}
