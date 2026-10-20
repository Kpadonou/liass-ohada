import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
export const RESTAURANT_RECEIPT_ROUTES = [
  {
    name: "publish-receipt",
    method: "POST",
    path: "/restaurants/outlets/{outletId}/sessions/{sessionId}/receipt",
    permission: "RESTAURANTS_RECEIPT_MANAGE" satisfies DomainPermission,
    receipt: "PUBLISH",
  },
  {
    name: "get-receipt",
    method: "GET",
    path: "/restaurants/outlets/{outletId}/sessions/{sessionId}/receipt",
    permission: "RESTAURANTS_RECEIPT_READ" satisfies DomainPermission,
    receipt: "READ",
  },
] as const;
