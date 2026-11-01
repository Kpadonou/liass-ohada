const base = "/restaurants/outlets/{outletId}";
export const RESTAURANT_CREDIT_NOTE_ROUTES = [
  {
    method: "POST",
    path: `${base}/sessions/{guestSessionId}/credit-notes`,
    operation: "CREATE",
  },
  {
    method: "GET",
    path: `${base}/sessions/{guestSessionId}/credit-notes`,
    operation: "LIST",
  },
  {
    method: "GET",
    path: `${base}/credit-notes/{creditNoteId}`,
    operation: "DETAIL",
  },
] as const;
