import { restaurantsHandler } from "./restaurant-handler";
import { RESTAURANTS_ROUTES } from "./restaurant-routes";
import { INVENTORY_ROUTES } from "./inventory-routes";
import { inventoryHandler } from "./inventory-handler";
import {
  createHandler,
  AppError,
} from "@/lambda/shared/middleware/handler-wrapper";
import { z } from "zod";
import { TRACKING_PATH, TRACKING_ROUTES } from "./inventory-routes";
import { trackingHandler } from "./inventory-tracking-handler";

const original = restaurantsHandler("get-outlet");
const routes = new Map([
  ...RESTAURANTS_ROUTES.filter((r) => r.kind === "outlet").map(
    (r) =>
      [
        `${r.method} ${r.path}`,
        r.name === "get-outlet" ? original : restaurantsHandler(r.name),
      ] as const,
  ),
  ...INVENTORY_ROUTES.map(
    (r) => [`${r.method} ${r.path}`, inventoryHandler(r.operation)] as const,
  ),
  ...TRACKING_ROUTES.map(
    (method) =>
      [`${method} ${TRACKING_PATH}`, trackingHandler(method)] as const,
  ),
]);
const unknown = createHandler(
  z.object({}).passthrough(),
  async () => {
    throw new AppError(404, "RESTAURANTS_NOT_FOUND");
  },
  {
    action: "OUTLET_MANAGEMENT_UNKNOWN",
    productCode: "RESTAURANTS",
    permission: "RESTAURANTS_SETUP_MANAGE",
  },
);
/** Exact route allowlist selects the original per-operation authorization before execution. */
export const handler: typeof original = async (event) => {
  if (
    event.routeKey === "ANY /restaurants/outlets/{outletId}/inventory/items" ||
    event.routeKey ===
      "ANY /restaurants/outlets/{outletId}/inventory/items/{proxy+}"
  ) {
    const path = event.rawPath;
    const method = event.requestContext.http?.method;
    for (const route of INVENTORY_ROUTES) {
      const names = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const match = new RegExp(
        "^" + route.path.replace(/\{\w+\}/g, "([^/]+)") + "$",
      ).exec(path);
      if (route.method === method && match)
        return routes.get(`${route.method} ${route.path}`)!({
          ...event,
          routeKey: `${route.method} ${route.path}`,
          pathParameters: Object.fromEntries(
            names.map((name, index) => [name, match[index + 1]]),
          ),
        });
    }
    return unknown(event);
  }
  return (routes.get(event.routeKey) ?? unknown)(event);
};
