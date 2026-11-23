import {
  verifyRestaurantIssuanceProvenance,
  bindRestaurantIssuanceProvenance,
} from "@/lambda/domains/restaurants/issuance-provenance";
import { provenance } from './provenance-fixture';
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
test('organization-attested address is frozen without upgrading it to verified evidence',()=>{
  const {bindingDigest: _digest,...payload}=provenance;
  const captured=bindRestaurantIssuanceProvenance({...payload,
    seller:{...payload.seller,authorityReference:'ORGANIZATION_ADMIN_ATTESTATION',
      factStates:payload.seller.factStates.map(f=>f.fieldPath.startsWith('address.')
        ? {fieldPath:f.fieldPath,state:'ORGANIZATION_ATTESTED' as const}:f)}});
  expect(captured.seller.factStates.filter(f=>f.fieldPath.startsWith('address.')))
    .toEqual(expect.arrayContaining([
      {fieldPath:'address.lines.0',state:'ORGANIZATION_ATTESTED'},
      {fieldPath:'address.city',state:'ORGANIZATION_ATTESTED'},
    ]));
  expect(verifyRestaurantIssuanceProvenance(captured,{
    orgId:payload.orgId,outletId:payload.outletId,invoiceId:payload.invoiceId,
    guestSessionId:payload.guestSessionId,commercialRootDigest:payload.commercialRootDigest,
    issuedAt:payload.issuedAt})).toMatchObject({verified:true});
});
