import { restaurantsHandler } from "./restaurant-handler";
import { RESTAURANTS_ROUTES } from "./restaurant-routes";
import { INVENTORY_ROUTES } from "./inventory-routes";
import { inventoryHandler } from "./inventory-handler";
import {
  createHandler,
  AppError,
} from "@/lambda/shared/middleware/handler-wrapper";
import { z } from "zod";

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
export const handler: typeof original = async (event) =>
  (routes.get(event.routeKey) ?? unknown)(event);
