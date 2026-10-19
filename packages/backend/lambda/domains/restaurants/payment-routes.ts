import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
export const RESTAURANT_PAYMENT_ROUTES = [
  {
    name: "capture-payment",
    method: "POST",
    path: "/restaurants/outlets/{outletId}/sessions/{sessionId}/payments",
    permission: "RESTAURANTS_PAYMENT_CAPTURE_MANAGE" satisfies DomainPermission,
    payment: "CAPTURE",
  },
] as const;
