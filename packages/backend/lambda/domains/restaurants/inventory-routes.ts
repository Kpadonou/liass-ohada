const base = "/restaurants/outlets/{outletId}/inventory/items";
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
