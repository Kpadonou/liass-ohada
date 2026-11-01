const base = "/restaurants/outlets/{outletId}";
export const RESTAURANT_REFUND_ROUTES = [
  {
    method: "POST",
    path: `${base}/credit-notes/{creditNoteId}/refunds`,
    operation: "CREATE",
  },
  {
    method: "GET",
    path: `${base}/credit-notes/{creditNoteId}/refunds`,
    operation: "LIST",
  },
  { method: "GET", path: `${base}/refunds/{refundId}`, operation: "DETAIL" },
] as const;
