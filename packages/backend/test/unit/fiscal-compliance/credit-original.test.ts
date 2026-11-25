import { confirmedCreditOriginal, originalCreditWireReference, signedCreditReceipt } from "@/lambda/domains/fiscal-compliance/core/credit-original";
import type { FiscalAttemptState } from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";
const scope = { orgId: "org", sourceDomain: "sales", sourceDocumentId: "invoice", sourceDigest: "a".repeat(64) };
const state = () => ({ identity: { ...scope, environment: "TEST", sourceDocumentType: "INVOICE" },
  obligationId: "original", sourceDigest: scope.sourceDigest, status: "CONFIRMED", execution: "REAL_TEST",
  fiscalDocumentType: "FV", securityEvidenceOrigin: "DGI_TEST", security: {
    codeMECeFDGI: "FK3J-EFIN-FDZQ-NEBN-PSAI-UAZV", nim: "ED04999905", counters: "1054 / 1378 FV",
    qrCode: "original-qr", dateTime: "original-date",
  } } as unknown as FiscalAttemptState);
test("reference example preserves original evidence and separates print reference from unresolved API encoding", () => {
  const original = confirmedCreditOriginal(state(), scope);
  expect(original.printedReference).toBe("ED04999905 - 1378");
  expect(original.security.codeMECeFDGI).toBe(state().security!.codeMECeFDGI);
  expect(() => originalCreditWireReference(original)).toThrow("REFERENCE_MAPPING_REQUIRED");
});
test.each(["orgId", "sourceDomain", "sourceDocumentId", "sourceDigest"] as const)("original cannot cross %s", field => {
  expect(() => confirmedCreditOriginal(state(), { ...scope, [field]: "other" })).toThrow();
});
test.each(["UNKNOWN_OUTCOME", "CREATED", "CANCELLED"])("%s original is ineligible", status => {
  expect(() => confirmedCreditOriginal({ ...state(), status } as FiscalAttemptState, scope)).toThrow();
});
test("raw 24-character code passes verbatim with no punctuation conversion", () => {
  const s = state(); s.security!.codeMECeFDGI = "123456789012345678901234";
  expect(originalCreditWireReference(confirmedCreditOriginal(s, scope))).toBe(s.security!.codeMECeFDGI);
});
test("case06 receipt signs are separate from positive source magnitudes and own confirmation", () => {
  const original = confirmedCreditOriginal(state(), scope);
  const lines = [{ quantity: 2, amountMinor: 10000, taxMinor: 0, taxGroup: "A" },
    { quantity: 3, amountMinor: 4500, taxMinor: 686, taxGroup: "B" }];
  const result = signedCreditReceipt({ original, lines, security: { ...state().security!,
    codeMECeFDGI: "NW5U-OSWU-RSGU-U6MS-NYZE-2IKJ", qrCode: "own-credit-qr", counters: "164 / 1384 FA" }, evidenceOrigin: "DGI_TEST" });
  expect(result.totalMinor).toBe(-14500);
  expect(result.lines.map(x => x.quantity)).toEqual([-2, -3]);
  expect(result.groups.B).toEqual({ netMinor: -3814, taxMinor: -686, totalMinor: -4500 });
  expect(result.groups.A.netMinor).toBe(-10000);
  expect(lines[0].quantity).toBe(2);
  expect(result.originalReference).toBe("ED04999905 - 1378");
});
test("cannot print original security as credit confirmation", () => {
  const original = confirmedCreditOriginal(state(), scope);
  expect(() => signedCreditReceipt({ original, lines: [{ quantity: 1, amountMinor: 100, taxMinor: 0, taxGroup: "A" }],
    security: state().security, evidenceOrigin: "DGI_TEST" })).toThrow("CREDIT_FISCAL_CONFIRMATION_REQUIRED");
});
