export const RESTAURANT_DOCUMENT_COLLECTION_ROUTES = [
  {
    method: "GET",
    path: "/restaurants/outlets/{outletId}/invoices",
    operation: "INVOICES",
    kind: "INV",
  },
  {
    method: "GET",
    path: "/restaurants/outlets/{outletId}/credit-notes",
    operation: "CREDIT_NOTES",
    kind: "CN",
  },
] as const;
