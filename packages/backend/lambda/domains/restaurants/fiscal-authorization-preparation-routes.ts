import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";

export const RESTAURANT_FISCAL_AUTHORIZATION_PREPARATION_ROUTE = {
  name: "prepare-test-fiscal-authorization",
  method: "POST",
  path: "/restaurants/outlets/{outletId}/sessions/{sessionId}/invoices/{invoiceId}/fiscal/test-authorization-preparations",
  permission: "RESTAURANTS_RECEIPT_MANAGE" satisfies DomainPermission,
} as const;
