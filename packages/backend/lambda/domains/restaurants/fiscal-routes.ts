import type { DomainPermission } from "@/lambda/shared/authorization/domain-permission";
const path =
  "/restaurants/outlets/{outletId}/sessions/{sessionId}/invoices/{invoiceId}/fiscal";
/** Existing JWT route contracts; dedicated real TEST integration remains disabled by default. */
export const RESTAURANT_FISCAL_ROUTES = [
  {
    name: "initiate-fiscal",
    method: "POST",
    path,
    permission: "RESTAURANTS_RECEIPT_MANAGE" satisfies DomainPermission,
    operation: "initiate",
  },
  {
    name: "confirm-fiscal",
    method: "PUT",
    path: `${path}/confirm`,
    permission: "RESTAURANTS_RECEIPT_MANAGE" satisfies DomainPermission,
    operation: "confirm",
  },
  {
    name: "get-fiscal-status",
    method: "GET",
    path,
    permission: "RESTAURANTS_RECEIPT_READ" satisfies DomainPermission,
    operation: "status",
  },
  {
    name: "get-fiscal-result",
    method: "GET",
    path: `${path}/result`,
    permission: "RESTAURANTS_RECEIPT_READ" satisfies DomainPermission,
    operation: "confirmedResult",
  },
] as const;
