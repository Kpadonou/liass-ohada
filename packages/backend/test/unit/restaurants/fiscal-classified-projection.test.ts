import { projectRestaurantInvoiceV1 } from "@/lambda/domains/restaurants/fiscalizable-invoice-v1";
import { identifierDigest, tzdbDigest } from "@/lambda/shared/authority/iana-pinned-digests";
import { digest, id, issuedAt, line, provenance, scope } from "./provenance-fixture";

test("mixed A/B FINAL evidence projects each frozen group and reconciles rounded amounts", () => {
  const authIssuedAt = "2026-11-06T10:00:00.000Z";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const treatment = (group: "A" | "B", rateBasisPoints: 0 | 1800) => ({
    country: "BJ" as const, catalogGroup: group, effectiveGroup: group,
    regime: "ORDINARY_VAT" as const, regimeRevision: id,
    policyId: "BJ-RESTO-TTC" as const, policyVersion: 1 as const,
    rateBasisPoints, rounding: "HALF_UP_LINE" as const,
  });
  const first = { ...line, netAmountMinor: 1000, snapshot: { ...line.snapshot,
    quantity: 1, unitPriceMinor: 1000, grossMinor: 1000, subtotalMinor: 1000,
    lineTotalMinor: 1000, fiscalTreatment: treatment("A", 0) } };
  const second = { ...line, itemId: secondId, netAmountMinor: 1180, snapshot: { ...line.snapshot,
    name: "Taxable article", quantity: 1, unitPriceMinor: 1180, grossMinor: 1180,
    subtotalMinor: 1000, taxMinor: 180, lineTotalMinor: 1180,
    fiscalTreatment: treatment("B", 1800) } };
  const verified = { verified: true as const, evidence: {
    source: { ...scope, guestSessionId: id, invoiceId: id, sourceVersion: 1, financialRevision: 1 },
    invoice: { currency: "XOF", dueMinor: 2180, paidMinor: 2180, paymentCount: 1,
      paidByMethodMinor: { CASH: 2180, MOBILE_MONEY: 0, CARD: 0 }, lineCount: 2, issuedAt: authIssuedAt },
    proof: { algorithm: "SHA256", digest }, parts: [],
    lines: [
      { line: first, coordinate: { orderId: id, itemId: id, partNumber: 1, position: 0 } },
      { line: second, coordinate: { orderId: id, itemId: secondId, partNumber: 1, position: 1 } },
    ],
    issuanceProvenance: { verified: true as const, evidence: {
      ...provenance, evidenceOrigin: "AUTHENTIC" as const,
      issuedAt: authIssuedAt,
      seller: { ...provenance.seller, seller: { ...provenance.seller.seller, country: "BJ" } },
      timezone: { ...provenance.timezone, tzdbArtifactDigest: tzdbDigest,
        acceptedIdentifierArtifactDigest: identifierDigest },
    } },
  } };
  const result = projectRestaurantInvoiceV1(verified.evidence as never);
  expect(result.document.lines.map((v) => "effectiveGroup" in v.fiscalTreatmentEvidence
    ? v.fiscalTreatmentEvidence.effectiveGroup : undefined)).toEqual(["A", "B"]);
  expect(result.document.totals).toEqual({ netMinor: "2000", taxMinor: "180", totalMinor: "2180" });
});
