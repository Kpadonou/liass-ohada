import { handler } from "@/lambda/domains/restaurants/get-outlet";
import {
  INVENTORY_GATEWAY_PATH,
  INVENTORY_ROUTES,
  TRACKING_PATH,
  TRACKING_ROUTES,
  INVENTORY_BUSINESS_ROUTES,
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
test.each(INVENTORY_BUSINESS_ROUTES)(
  "Canonical exact $method $path dispatches with its original operation authorization",
  async (route) => {
    const expected = routes.find(
      (r) => r.method === route.method && r.path === route.path,
    )!;
    const event = {
      routeKey: `${route.method} ${route.path}`,
      rawPath: route.path.replace(/\{\w+\}/g, "canonical-id"),
      pathParameters: {
        outletId: "canonical-id",
        stockItemId: "canonical-id",
        menuItemId: "canonical-id",
      },
      requestContext: { http: { method: route.method } },
    };
    const response = await handler(event as never);
    expect(JSON.parse(response.body).operation).toBe(expected.operation);
  },
);

test.each([
  ["DELETE", "items/stock-id"],
  ["PUT", "items"],
  ["POST", "menu-items/menu-id/tracking"],
  ["GET", "items/stock-id/unknown"],
  ["OPTIONS", "items/stock-id/movements"],
])("Exact dispatcher rejects unsupported %s %s", async (method, suffix) => {
  const path = `/restaurants/outlets/{outletId}/inventory/${suffix}`;
  const response = await handler({
    routeKey: `${method} ${path}`,
    rawPath: path,
    requestContext: { http: { method } },
  } as never);
  expect(response.statusCode).toBe(404);
});
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

test.each(["PUT", "DELETE"])(
  "Inventory exact tracking %s route reuses the existing dispatcher allowlist",
  async (method) => {
    const event = {
      routeKey: `${method} ${TRACKING_PATH}`,
      rawPath:
        "/restaurants/outlets/outlet-id/inventory/menu-items/menu-id/tracking",
      pathParameters: { outletId: "outlet-id", menuItemId: "menu-id" },
      requestContext: { http: { method } },
      body: JSON.stringify({ categoryId: "category-id" }),
    };
    const response = await handler(event as never);
    const data = JSON.parse(response.body);
    expect(data.operation).toBe(`tracking-${method}`);
    expect(data.event).toEqual(event);
  },
);

test.each([
  ["POST", "menu-items/menu-id/tracking"],
  ["PATCH", "menu-items/menu-id/tracking"],
  ["PUT", "items"],
  ["DELETE", "items/stock-id"],
  ["OPTIONS", "menu-items/menu-id/tracking"],
])("Inventory allowlist rejects unsupported %s %s", async (method, path) => {
  const response = await handler({
    routeKey: `${method} ${INVENTORY_GATEWAY_PATH}`,
    rawPath: `/restaurants/outlets/outlet-id/inventory/${path}`,
    requestContext: { http: { method } },
  } as never);
  expect(response.statusCode).toBe(404);
});
