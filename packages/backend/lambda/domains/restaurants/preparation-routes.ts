import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
const base = "/restaurants/outlets/{outletId}";
export const RESTAURANT_PREPARATION_ROUTES = [
  {
    name: "station-preparation",
    method: "GET",
    path: `${base}/preparation-stations/{stationId}/work/{state}`,
    permission: "RESTAURANTS_PREPARATION_READ",
    preparation: "LANE",
  },
  {
    name: "order-preparation",
    method: "GET",
    path: `${base}/orders/{orderId}/preparation`,
    permission: "RESTAURANTS_PREPARATION_READ",
    preparation: "ORDER",
  },
  {
    name: "start-preparation",
    method: "POST",
    path: `${base}/orders/{orderId}/items/{itemId}/preparation/{fireId}/start`,
    permission: "RESTAURANTS_PREPARATION_START_MANAGE",
    preparation: "START",
  },
  {
    name: "ready-preparation",
    method: "POST",
    path: `${base}/orders/{orderId}/items/{itemId}/preparation/{fireId}/ready`,
    permission: "RESTAURANTS_PREPARATION_READY_MANAGE",
    preparation: "READY",
  },
  {
    name: "serve-preparation",
    method: "POST",
    path: `${base}/orders/{orderId}/items/{itemId}/preparation/{fireId}/serve`,
    permission: "RESTAURANTS_PREPARATION_SERVE_MANAGE",
    preparation: "SERVE",
  },
] as const satisfies readonly {
  name: string;
  method: "GET" | "POST";
  path: string;
  permission: DomainPermission;
  preparation: string;
}[];
