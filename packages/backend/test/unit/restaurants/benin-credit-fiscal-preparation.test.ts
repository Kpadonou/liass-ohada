import { randomUUID } from "node:crypto";
import { prepareRestaurantBeninCredit } from "@/lambda/domains/restaurants/benin-credit-fiscal-preparation";
import { RestaurantCreditNoteFiscalSource } from "@/lambda/domains/restaurants/credit-note-fiscal-source";
import * as originalPreparation from "@/lambda/domains/restaurants/fiscal-preparation";
import * as originalMapper from "@/lambda/domains/restaurants/benin-fiscal-request-mapper";

const outletId = randomUUID(), sessionId = randomUUID(), invoiceId = randomUUID(), creditNoteId = randomUUID();
const orderId = randomUUID(), aId = randomUUID(), bId = randomUUID();
const originalDigest = "a".repeat(64), code = "M".repeat(24);
const principal = { orgId: "org", actorId: "manager" };
const identity = { orgId: "org", environment: "TEST" as const,
  sourceDomain: "restaurants", sourceDocumentType: "CREDIT_NOTE", sourceDocumentId: creditNoteId,
  jurisdiction: "BJ", obligation: "NORMALIZE" };
const config = (invoiceType: "FA" | "EA") => ({ environment: "TEST", invoiceType,
  priceBasis: "TTC", pricingEvidence: "frozen-price", commercialMinorUnitsPerFranc: 1,
  taxGroups: ["A", "B", "C", "E"], taxMetadataEvidence: "frozen-tax",
  operator: { actorId: "manager", name: "Manager", evidence: "staff" },
  payments: [{ sourceMethod: "CASH", providerMethod: "ESPECES", evidence: "cash" }] });
afterEach(() => jest.restoreAllMocks());
function arrange(type: "FV" | "EV", groups: ("A" | "B" | "C" | "E")[]) {
  const lines = groups.map((group, index) => ({ orderId, itemId: index ? bId : aId,
    creditedQuantity: index && group === "B" ? 3 : 2,
    unitAmountMinor: group === "B" ? 118 : 100,
    creditedAmountMinor: group === "B" ? 354 : 200,
    taxMinor: group === "B" ? 54 : 0 }));
  const total = lines.reduce((n, line) => n + line.creditedAmountMinor, 0);
  jest.spyOn(RestaurantCreditNoteFiscalSource, "verify").mockResolvedValue({
    credit: { data: { amountMinor: total }, lines },
    original: { proof: { digest: originalDigest } },
    originalFiscal: { fiscalDocumentType: type, sourceDigest: originalDigest,
      identity: { orgId: "org", sourceDomain: "restaurants", sourceDocumentId: invoiceId, sourceDocumentType: "INVOICE", environment: "TEST" },
      status: "CONFIRMED", execution: "REAL_TEST", securityEvidenceOrigin: "DGI_TEST", obligationId: "original",
      security: { codeMECeFDGI: code } }, sourceDigest: "b".repeat(64),
  } as never);
  jest.spyOn(originalPreparation, "prepareRestaurantFiscalInvoice").mockResolvedValue({
    ready: true, preparation: { commercialRootDigest: originalDigest,
      lines: groups.map((group, index) => ({ commercial: { orderId,
        itemId: index ? bId : aId, snapshot: { fiscalTreatment: { effectiveGroup: group,
          rateBasisPoints: group === "B" ? 1800 : 0 } } } })) },
  } as never);
  jest.spyOn(originalMapper, "mapRestaurantBeninRequest").mockReturnValue({
    sourceDigest: originalDigest, payload: { invoice: { ifu: "1234567890123",
      client: { name: "Client", ifu: "9876543210123" },
      items: groups.map((group, index) => ({ name: `Article ${group}`,
        price: lines[index].unitAmountMinor, quantity: lines[index].creditedQuantity,
        taxGroup: group })) } },
  } as never);
  return lines;
}
test("scenario 06 prepares FA from A+B commercial credits, original FV and customer IFU", async () => {
  arrange("FV", ["A", "B"]);
  const result = await prepareRestaurantBeninCredit({ principal, identity, outletId,
    sessionId, invoiceId, classifications: [], mapping: config("FA") });
  expect(result).toMatchObject({ sourceDigest: "b".repeat(64), total: 554,
    fiscalGroupTotals: { A: { gross: 200, net: 200, tax: 0 },
      B: { gross: 354, net: 300, tax: 54 } },
    payload: { invoice: { type: "FA", reference: code,
      client: { name: "Client", ifu: "9876543210123" },
      items: [{ taxGroup: "A", quantity: 2, price: 100 },
        { taxGroup: "B", quantity: 3, price: 118 }] },
      expected: { itemTotals: [200, 354], total: 554 } } });
});
test.each(["C", "E"] as const)("scenario EA %s preserves original EV treatment and DGI code", async group => {
  arrange("EV", [group]);
  const result = await prepareRestaurantBeninCredit({ principal, identity, outletId,
    sessionId, invoiceId, classifications: [], mapping: config("EA") });
  expect(result.payload).toMatchObject({ invoice: { type: "EA", reference: code,
    items: [{ taxGroup: group, quantity: 2 }] } });
});
test("wrong original type fails before any provider request", async () => {
  arrange("EV", ["C"]);
  await expect(prepareRestaurantBeninCredit({ principal, identity, outletId,
    sessionId, invoiceId, classifications: [], mapping: config("FA") }))
    .rejects.toThrow("FISCAL_ORIGINAL_TYPE_MISMATCH");
});
