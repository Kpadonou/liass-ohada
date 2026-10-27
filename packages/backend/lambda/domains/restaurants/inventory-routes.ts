const base = "/restaurants/outlets/{outletId}/inventory/items";
// Explicit business methods leave OPTIONS to the shared HTTP API CORS responder.
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
