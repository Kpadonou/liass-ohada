import { prepareRestaurantFiscalInvoice } from "@/lambda/domains/restaurants/fiscal-preparation";
import { bindRestaurantIssuanceProvenance } from "@/lambda/domains/restaurants/issuance-provenance";
import { RestaurantInvoiceSourceVerifier } from "@/lambda/domains/restaurants/invoice-source-verifier";

import {
  id,
  digest,
  scope,
  issuedAt,
  line,
  provenance,
} from "./provenance-fixture";
const evidence = {
  issuanceProvenance: { verified: true, evidence: provenance },
  source: {
    ...scope,
    guestSessionId: id,
    invoiceId: id,
    sourceVersion: 1,
    financialRevision: 1,
  },
  invoice: {
    issuedAt,
    lineCount: 1,
    currency: "XOF",
    dueMinor: 2000,
    paidMinor: 2000,
  },
  proof: { digest },
  lines: [
    {
      coordinate: { orderId: id, itemId: id, partNumber: 1, position: 0 },
      line: { ...line, snapshot: { ...line.snapshot, fiscalTreatment: {
        country: "BJ", catalogGroup: "A", effectiveGroup: "A", regime: "ORDINARY_VAT",
        regimeRevision: id, policyId: "BJ-RESTO-TTC", policyVersion: 1,
        rateBasisPoints: 0, rounding: "HALF_UP_LINE",
      } } },
    },
  ],
};
const read = (value: unknown) =>
  jest.fn(
    async () => value,
  ) as unknown as typeof RestaurantInvoiceSourceVerifier.verify;
const request = {
  scope,
  actorId: "synthetic-actor",
  sessionId: id,
  invoiceId: id,
  issuanceProvenance: provenance,
  classifications: [
    {
      orderId: id,
      itemId: id,
      taxGroup: "B",
      classificationEvidence: "synthetic-tax-review",
    },
  ],
};

test("binds verified FINAL source, explicit classification, immutable provenance and exact amount", async () => {
  const result = await prepareRestaurantFiscalInvoice(
    request,
    read({ verified: true, evidence }),
  );
  expect(result.ready).toBe(true);
  if (!result.ready) return;
  expect(result.preparation.source).toEqual(evidence.source);
  expect(result.preparation.commercialRootDigest).toBe(digest);
  expect(result.preparation.totalMinor).toBe("2000");
  expect(result.preparation.lines[0].commercial).toEqual(evidence.lines[0].line);
  expect(result.preparation.lines[0].fiscal.taxGroup).toBe("A");
  expect(result.preparation.providerMutationEnabled).toBe(false);
});

test("denies unverified source before mapping", async () => {
  expect(
    await prepareRestaurantFiscalInvoice(
      request,
      read({ verified: false, denial: { code: "NOT_FINAL" } }),
    ),
  ).toEqual({ ready: false, reason: "NOT_FINAL" });
});

test("never synthesizes historical seller or timezone provenance", async () => {
  const result = await prepareRestaurantFiscalInvoice(
    { ...request, issuanceProvenance: undefined },
    read({
      verified: true,
      evidence: { ...evidence, issuanceProvenance: undefined },
    }),
  );
  expect(result).toEqual({ ready: false, reason: "PROVENANCE_UNAVAILABLE" });
});

test("ignores external classification when the FINAL line has a frozen treatment", async () => {
  for (const classifications of [
    [],
    [{ ...request.classifications[0], taxGroup: "Z" }],
  ]) {
    const result = await prepareRestaurantFiscalInvoice(
      { ...request, classifications },
      read({ verified: true, evidence }),
    );
    expect(result.ready).toBe(true);
    if (result.ready) expect(result.preparation.lines[0].fiscal.taxGroup).toBe("A");
  }
});

test("legacy FINAL lines without frozen treatment cannot be reclassified by settings", async () => {
  const result = await prepareRestaurantFiscalInvoice(request,
    read({ verified: true, evidence: { ...evidence, lines: [{ ...evidence.lines[0], line }] } }));
  expect(result).toEqual({ ready: false, reason: "MISSING_FISCAL_CLASSIFICATION" });
});

test("rejects financial and provenance binding mismatches", async () => {
  const amount = await prepareRestaurantFiscalInvoice(
    request,
    read({
      verified: true,
      evidence: {
        ...evidence,
        invoice: { ...evidence.invoice, dueMinor: 1999, paidMinor: 1999 },
      },
    }),
  );
  expect(amount).toEqual({ ready: false, reason: "SOURCE_AMOUNT_MISMATCH" });
  const binding = await prepareRestaurantFiscalInvoice(
    request,
    read({
      verified: true,
      evidence: { ...evidence, proof: { digest: "b".repeat(64) } },
    }),
  );
  expect(binding).toEqual({ ready: false, reason: "PROVENANCE_INTEGRITY" });
});
