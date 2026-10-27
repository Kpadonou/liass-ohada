import { handler } from "@/lambda/domains/restaurants/get-outlet";
import {
  INVENTORY_GATEWAY_PATH,
  INVENTORY_ROUTES,
  TRACKING_PATH,
  TRACKING_ROUTES,
} from "@/lambda/domains/restaurants/inventory-routes";
jest.mock("@/lambda/domains/restaurants/restaurant-handler", () => ({
  restaurantsHandler: (operation: string) => async () => ({
    statusCode: 200,
    body: JSON.stringify({ operation }),
  }),
}));
jest.mock("@/lambda/domains/restaurants/inventory-handler", () => ({
  inventoryHandler: (operation: string) => async (event: unknown) => ({
    statusCode: 200,
    body: JSON.stringify({ operation, event }),
  }),
}));
jest.mock("@/lambda/domains/restaurants/inventory-tracking-handler", () => ({
  trackingHandler: (method: string) => async (event: unknown) => ({
    statusCode: 200,
    body: JSON.stringify({ operation: `tracking-${method}`, event }),
  }),
}));
jest.mock("@/lambda/shared/middleware/handler-wrapper", () => ({
  createHandler: () => async () => ({ statusCode: 404, body: "{}" }),
}));
const routes = [
  ...INVENTORY_ROUTES,
  ...TRACKING_ROUTES.map((method) => ({
    method,
    path: TRACKING_PATH,
    operation: `tracking-${method}`,
  })),
];
test.each(routes)(
  "Inventory method routing preserves exact $method $path handler and parameters",
  async (route) => {
    const rawPath = route.path
      .replace("{outletId}", "outlet-id")
      .replace("{stockItemId}", "stock-id")
      .replace("{menuItemId}", "menu-id");
    const response = await handler({
      routeKey: `${route.method} ${INVENTORY_GATEWAY_PATH}`,
      rawPath,
      pathParameters: {
        outletId: "outlet-id",
        proxy: "untrusted-routing-placeholder",
      },
      queryStringParameters: { limit: "50" },
      requestContext: { http: { method: route.method } },
    } as never);
    const data = JSON.parse(response.body);
    expect(data.operation).toBe(route.operation);
    expect(data.event.routeKey).toBe(`${route.method} ${route.path}`);
    expect(data.event.pathParameters.outletId).toBe("outlet-id");
    expect(data.event.pathParameters.proxy).toBeUndefined();
    if (route.path.includes("{stockItemId}"))
      expect(data.event.pathParameters.stockItemId).toBe("stock-id");
    if (route.path.includes("{menuItemId}"))
      expect(data.event.pathParameters.menuItemId).toBe("menu-id");
    expect(data.event.queryStringParameters).toEqual({ limit: "50" });
  },
);
test.each([
  "/inventory/items/item/unknown",
  "/inventory/menu-items/item/unknown",
])("Inventory route allowlist rejects unsupported path %s", async (suffix) => {
  const response = await handler({
    routeKey: `GET ${INVENTORY_GATEWAY_PATH}`,
    rawPath: `/restaurants/outlets/outlet-id${suffix}`,
    requestContext: { http: { method: "GET" } },
  } as never);
  expect(response.statusCode).toBe(404);
});
