import {
  verifyRestaurantIssuanceProvenance,
  bindRestaurantIssuanceProvenance,
} from "@/lambda/domains/restaurants/issuance-provenance";
const expected = {
  orgId: "org",
  outletId: "outlet",
  invoiceId: "invoice",
  guestSessionId: "session",
  commercialRootDigest: "a".repeat(64),
  issuedAt: "2026-11-05T10:00:00Z",
};
test("historical FINAL absence remains explicitly unavailable without current authority lookup", () => {
  expect(verifyRestaurantIssuanceProvenance(undefined, expected)).toEqual({
    verified: false,
    reason: "PROVENANCE_UNAVAILABLE",
  });
});
test("malformed provenance never becomes verified evidence", () => {
  expect(
    verifyRestaurantIssuanceProvenance(
      { seller: { orgId: "other" } },
      expected,
    ),
  ).toEqual({ verified: false, reason: "PROVENANCE_INTEGRITY" });
  expect(() => bindRestaurantIssuanceProvenance({} as never)).toThrow();
});
