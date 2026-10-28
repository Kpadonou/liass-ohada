const base = "/restaurants/outlets/{outletId}/inventory/items";
// Legacy dispatcher compatibility during deployment only; never register these groups.
export const INVENTORY_GATEWAY_PATH =
  "/restaurants/outlets/{outletId}/inventory/{proxy+}";
export const INVENTORY_GATEWAY_METHODS = [
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
] as const;
export const TRACKING_PATH =
  "/restaurants/outlets/{outletId}/inventory/menu-items/{menuItemId}/tracking";
export const TRACKING_ROUTES = ["GET", "PUT", "DELETE"] as const;
export const INVENTORY_ROUTES = [
  { operation: "list", method: "GET", path: base },
  { operation: "create", method: "POST", path: base },
  { operation: "get", method: "GET", path: `${base}/{stockItemId}` },
  { operation: "update", method: "PATCH", path: `${base}/{stockItemId}` },
  {
    operation: "movement",
    method: "POST",
    path: `${base}/{stockItemId}/movements`,
  },
  {
    operation: "history",
    method: "GET",
    path: `${base}/{stockItemId}/movements`,
  },
] as const;

/** Canonical business surface shared by Gateway registration and dispatcher checks. */
export const INVENTORY_BUSINESS_ROUTES = [
  ...INVENTORY_ROUTES.map((route) => ({
    ...route,
    handler: "management" as const,
    authentication: "JWT" as const,
  })),
  ...TRACKING_ROUTES.map((method) => ({
    method,
    path: TRACKING_PATH,
    handler: "tracking" as const,
    authentication: "JWT" as const,
  })),
] as const;
/** Transport grant only; exact routes and per-operation authorization remain authoritative. */
export const INVENTORY_INVOKE_PATH = "/restaurants/outlets/*/inventory/*";
