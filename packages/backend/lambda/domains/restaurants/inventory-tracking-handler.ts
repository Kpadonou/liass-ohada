import { z } from "zod";
import * as C from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { InventoryTrackingService as Tracking } from "./inventory-tracking-service";
import { TRACKING_PATH, TRACKING_ROUTES } from "./inventory-routes";
export function trackingHandler(method: (typeof TRACKING_ROUTES)[number]) {
  const command =
    method === "GET"
      ? z.object({ categoryId: z.string().uuid() }).strict()
      : method === "DELETE"
        ? C.RemoveInventoryTrackingRequestSchema
        : C.SaveInventoryTrackingRequestSchema;
  return createHandler(
    z.object({}).passthrough(),
    async (_raw, context) => {
      const params = z
        .object({ outletId: z.string().uuid(), menuItemId: z.string().uuid() })
        .strict()
        .parse(context.event.pathParameters);
      const body = context.event.body ? JSON.parse(context.event.body) : {};
      const query = context.event.queryStringParameters ?? {};
      (method === "GET" ? z.object({}).strict() : command).parse(body);
      (method === "GET" ? command : z.object({}).strict()).parse(query);
      const scope = { orgId: context.orgId, outletId: params.outletId };
      const data =
        method === "GET"
          ? await Tracking.read(
              scope,
              z.object({ categoryId: z.string().uuid() }).parse(query)
                .categoryId,
              params.menuItemId,
            )
          : await Tracking.save(
              scope,
              params.menuItemId,
              context.userId,
              body,
              method === "DELETE",
            );
      return C.InventoryTrackingResponseSchema.parse({ data });
    },
    {
      action: `${method} ${TRACKING_PATH}`,
      productCode: "RESTAURANTS",
      permission: "RESTAURANTS_SETUP_MANAGE",
    },
  );
}
