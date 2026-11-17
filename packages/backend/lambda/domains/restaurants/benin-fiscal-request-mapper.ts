import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { createHash } from "node:crypto";
import { z } from "zod";
import { clean } from "@/lambda/shared/authority/integrity";
import {
  InvoiceRequestDataDtoSchema,
  PaymentTypeEnumSchema,
  TaxGroupTypeEnumSchema,
  canonicalBeninRequest,
} from "../fiscal-compliance/providers/benin-emecef/invoice-dtos";
import type {
  FiscalPrincipal,
  VerifiedFiscalPreparation,
} from "../fiscal-compliance/core/synthetic-fiscal-orchestrator";
import type { FiscalObligationIdentity } from "../fiscal-compliance/core/fiscal-attempt-state";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { restaurantQuantityAmountMinor } from "@liass-ohada/shared/restaurant-quantity";
import { mapRestaurantFiscalLines } from "./fiscal-line-mapper";
import { verifyRestaurantIssuanceProvenance } from "./issuance-provenance";
const evidence = z.string().trim().min(1).max(1000);
export const restaurantBeninMappingSchema = z
  .object({
    environment: z.literal("TEST"),
    invoiceType: z.enum(["FV", "EV"]),
    priceBasis: z.literal("TTC"),
    pricingEvidence: evidence,
    commercialMinorUnitsPerFranc: z.number().int().safe().positive(),
    taxGroups: z.array(TaxGroupTypeEnumSchema).min(1).max(6),
    taxMetadataEvidence: evidence,
    operator: z
      .object({ actorId: evidence, name: evidence, evidence })
      .strict(),
    payments: z
      .array(
        z
          .object({
            sourceMethod: z.enum(["CASH", "MOBILE_MONEY", "CARD"]),
            providerMethod: PaymentTypeEnumSchema,
            evidence,
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export const restaurantBeninCreditMappingSchema = restaurantBeninMappingSchema.extend({
  invoiceType: z.enum(["FA", "EA"]),
});
type Preparation = Extract<
  Awaited<ReturnType<typeof prepareRestaurantFiscalInvoice>>,
  { ready: true }
>["preparation"];

/** Pure explicit mapping. Configuration evidence is supplied by a trusted mapping
 * owner, never derived from zero commercial taxes, currency or item descriptions.
 */
export function mapRestaurantBeninRequest(
  preparation: Preparation,
  principal: FiscalPrincipal,
  identity: FiscalObligationIdentity,
  configuration: unknown,
  purpose: "EXECUTION" | "AUTHORIZATION_PROOF" = "EXECUTION",
): VerifiedFiscalPreparation {
  if (purpose === "EXECUTION" && process.env.NODE_ENV !== "test" && !realFiscalTestEnabled())
    throw new Error("FISCAL_MAPPING_DISABLED");
  const config = restaurantBeninMappingSchema.parse(configuration);
  const source = preparation.source;
  if (
    principal.orgId !== source.orgId ||
    identity.orgId !== source.orgId ||
    identity.sourceDocumentId !== source.invoiceId ||
    identity.sourceDomain !== "restaurants" ||
    identity.sourceDocumentType !== "INVOICE" ||
    identity.environment !== "TEST" ||
    identity.jurisdiction !== "BJ" ||
    principal.actorId !== config.operator.actorId
  )
    throw new Error("FISCAL_MAPPING_SCOPE_DENIED");
  const provenance = verifyRestaurantIssuanceProvenance(
    preparation.provenance,
    {
      orgId: source.orgId,
      outletId: source.outletId,
      invoiceId: source.invoiceId,
      guestSessionId: source.guestSessionId,
      issuedAt: preparation.issuedAt,
      commercialRootDigest: preparation.commercialRootDigest,
    },
  );
  if (!provenance.verified || preparation.currency !== "XOF")
    throw new Error("FISCAL_MAPPING_EVIDENCE_MISSING");
  if (
    provenance.evidence.sourceVersion !== source.sourceVersion ||
    provenance.evidence.financialRevision !== source.financialRevision
  )
    throw new Error("FISCAL_MAPPING_SOURCE_MISMATCH");
  if (
    realFiscalTestEnabled() &&
    provenance.evidence.evidenceOrigin !== "AUTHENTIC"
  )
    throw new Error("FISCAL_AUTHENTIC_PROVENANCE_REQUIRED");
  const seller = provenance.evidence.seller;
  const identifiers = seller.seller.identifiers
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value }) => value.scheme === "IFU" && value.issuingCountry === "BJ",
    );
  const verifiedFacts = new Set(
    seller.factStates
      .filter((v) => v.state === "VERIFIED" && v.evidenceReference)
      .map((v) => v.fieldPath),
  );
  const identifierVerified =
    identifiers.length === 1 &&
    (verifiedFacts.has("identifiers") ||
      ["scheme", "issuingCountry", "value"].every((field) =>
        verifiedFacts.has(`identifiers.${identifiers[0].index}.${field}`),
      ));
  if (identifiers.length !== 1 || !identifierVerified)
    throw new Error("FISCAL_SELLER_IFU_UNVERIFIED");
  if (realFiscalTestEnabled()) {
    const address = seller.seller.address;
    const addressPaths = address
      ? [
          ...address.lines.map((_, index) => `address.lines.${index}`),
          ...(address.city ? ["address.city"] : []),
          ...(address.postalCode ? ["address.postalCode"] : []),
        ]
      : [];
    if (
      !address ||
      !address.lines.length ||
      !verifiedFacts.has("name") ||
      addressPaths.some((path) => !verifiedFacts.has(path))
    )
      throw new Error("FISCAL_SELLER_IDENTITY_INCOMPLETE");
  }
  if (
    new Set(config.taxGroups).size !== config.taxGroups.length ||
    new Set(config.payments.map((v) => v.sourceMethod)).size !==
      config.payments.length
  )
    throw new Error("AMBIGUOUS_PROVIDER_MAPPING");
  const mapped = mapRestaurantFiscalLines({
    lines: preparation.lines.map((v) => v.commercial),
    classifications: preparation.lines.map((v) => {
      const { sourceLineId: _, ...classification } = v.fiscal;
      return {
        orderId: v.commercial.orderId,
        itemId: v.commercial.itemId,
        ...classification,
      };
    }),
  });
  if (
    mapped.totalMinor !== preparation.totalMinor ||
    mapped.currency !== preparation.currency ||
    preparation.lines.some(
      (v, i) =>
        v.sourceLineId !== mapped.lines[i].sourceLineId ||
        v.fiscal.sourceLineId !== v.sourceLineId,
    )
  )
    throw new Error("FISCAL_MAPPING_AMOUNT_MISMATCH");
  const units = BigInt(config.commercialMinorUnitsPerFranc);
  const francs = (value: string | number | bigint) => {
    const n = BigInt(value);
    if (
      n < 0n ||
      n % units !== 0n ||
      n / units > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new Error("FISCAL_PRICE_UNREPRESENTABLE");
    return Number(n / units);
  };
  const items = mapped.lines.map((v) => {
    if (!config.taxGroups.includes(v.fiscal.taxGroup))
      throw new Error("UNSUPPORTED_PROVIDER_TAX_GROUP");
    return {
      code: v.sourceLineId,
      name: v.commercial.snapshot.name,
      price: francs(v.commercial.snapshot.unitPriceMinor),
      quantity: v.commercial.snapshot.quantity,
      taxGroup: v.fiscal.taxGroup,
      ...(v.fiscal.taxSpecificMinor !== undefined ?
        { taxSpecific: francs(v.fiscal.taxSpecificMinor) } : {}),
    };
  });
  const groups = new Set(items.map((item) => item.taxGroup));
  // DGI SFE annex 2: EV accepts C (16), A+C (17), and E (19).
  // F remains reserved; no provider calculation is inferred for it.
  if (
    (config.invoiceType === "FV" && groups.has("C")) ||
    (config.invoiceType === "EV" &&
      !(
        (groups.size === 1 && (groups.has("C") || groups.has("E"))) ||
        (groups.size === 2 && groups.has("A") && groups.has("C"))
      ))
  )
    throw new Error("UNSUPPORTED_EXPORT_TAX_COMBINATION");
  const paid = z
    .object({
      CASH: z.number().int().safe().nonnegative(),
      MOBILE_MONEY: z.number().int().safe().nonnegative(),
      CARD: z.number().int().safe().nonnegative(),
    })
    .strict()
    .parse(preparation.paidByMethodMinor);
  const payment = Object.entries(paid)
    .filter(([, amount]) => amount > 0)
    .map(([method, amount]) => {
      const selected = config.payments.find((v) => v.sourceMethod === method);
      if (!selected) throw new Error("MISSING_PROVIDER_PAYMENT_MAPPING");
      return { name: selected.providerMethod, amount: francs(amount) };
    });
  const total = francs(mapped.totalMinor);
  const itemTotals = mapped.lines.map((v) =>
    francs(v.commercial.netAmountMinor),
  );
  if (
    total <= 0 ||
    payment.reduce((sum, v) => sum + BigInt(v.amount), 0n) !== BigInt(total) ||
    items.some((v, i) =>
      restaurantQuantityAmountMinor(v.price, v.quantity) !==
        mapped.lines[i].commercial.snapshot.grossMinor ||
      itemTotals[i] !== mapped.lines[i].commercial.snapshot.lineTotalMinor)
  )
    throw new Error("FISCAL_MAPPING_AMOUNT_MISMATCH");
  const invoice = InvoiceRequestDataDtoSchema.parse({
    ifu: identifiers[0].value.value,
    type: config.invoiceType,
    reference: source.invoiceId,
    operator: { name: config.operator.name },
    items,
    payment,
    ...(preparation.customer ? { client: { ...preparation.customer } } : {}),
    ...(preparation.aib ? { aib: preparation.aib } : {}),
  });
  const payload = { invoice, expected: { itemTotals, total } };
  const fiscalGroupTotals: Partial<
    Record<
      "A" | "B" | "C" | "D" | "E",
      { gross: number; net: number; tax: number }
    >
  > = {};
  for (const line of mapped.lines) {
    const group = line.fiscal.taxGroup;
    if (group === "F") throw new Error("UNSUPPORTED_PROVIDER_TAX_GROUP");
    const snapshot = line.commercial.snapshot;
    const previous = fiscalGroupTotals[group] ?? { gross: 0, net: 0, tax: 0 };
    fiscalGroupTotals[group] = {
      gross: previous.gross + snapshot.lineTotalMinor,
      net: previous.net + snapshot.subtotalMinor,
      tax: previous.tax + snapshot.taxMinor,
    };
  }
  const specificTotal = mapped.lines.reduce((sum, line) =>
    sum + BigInt(line.commercial.snapshot.specificTaxMinor ?? 0), 0n);
  const accommodationTotal = mapped.lines.reduce((sum, line) =>
    sum + BigInt(line.commercial.snapshot.specificTaxKind === "ACCOMMODATION" ?
      line.commercial.snapshot.specificTaxMinor ?? 0 : 0), 0n);
  const vatTotal = mapped.lines.reduce((sum, line) =>
    sum + BigInt(line.commercial.snapshot.taxMinor), 0n);
  // DGI's published AIB clarification uses TTC excluding VAT and excludes
  // accommodation tax from the withholding base.
  const aibBase = BigInt(total) - BigInt(francs(vatTotal)) - BigInt(francs(accommodationTotal));
  if (aibBase < 0n) throw new Error("FISCAL_MAPPING_AMOUNT_MISMATCH");
  const aibRate = preparation.aib === "A" ? 1n : preparation.aib === "B" ? 5n : 0n;
  const aibTotal = (aibBase * aibRate + 50n) / 100n;
  if (aibTotal > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("FISCAL_MAPPING_AMOUNT_MISMATCH");
  return {
    identity,
    sourceDigest: preparation.commercialRootDigest,
    requestDigest: createHash("sha256")
      .update(canonicalBeninRequest(clean(payload)))
      .digest("hex"),
    total,
    ...(fiscalGroupTotals.B
      ? {
          ordinaryVatTotals: {
            net: fiscalGroupTotals.B.net,
            tax: fiscalGroupTotals.B.tax,
          },
        }
      : {}),
    fiscalGroupTotals,
    fiscalAdditionalTotals: { aib: Number(aibTotal), ts: francs(specificTotal) },
    payload,
  };
}

export function restaurantBeninPreparation(
  outletId: string,
  sessionId: string,
  classifications: unknown,
  configuration: unknown,
  prepare = prepareRestaurantFiscalInvoice,
  originalInvoiceId?: string,
) {
  return async (
    principal: FiscalPrincipal,
    identity: FiscalObligationIdentity,
  ) => {
    if (principal.orgId !== identity.orgId)
      throw new Error("FISCAL_MAPPING_SCOPE_DENIED");
    if (identity.sourceDocumentType === "CREDIT_NOTE") {
      if (!originalInvoiceId) throw new Error("FISCAL_ORIGINAL_REQUIRED");
      const { prepareRestaurantBeninCredit } = await import("./benin-credit-fiscal-preparation");
      return prepareRestaurantBeninCredit({ principal, identity, outletId, sessionId,
        invoiceId: originalInvoiceId, classifications, mapping: configuration });
    }
    const result = await prepare({
      scope: { orgId: principal.orgId, outletId },
      actorId: principal.actorId,
      sessionId,
      invoiceId: identity.sourceDocumentId,
      classifications,
      ...(realFiscalTestEnabled() ? { requireV1: true } : {}),
    });
    if (!result.ready) throw new Error("FISCAL_PREPARATION_UNAVAILABLE");
    const mapped = mapRestaurantBeninRequest(
      result.preparation,
      principal,
      identity,
      configuration,
    );
    if (
      realFiscalTestEnabled() &&
      restaurantBeninMappingSchema.parse(configuration)
        .commercialMinorUnitsPerFranc !== 1
    )
      throw new Error("FISCAL_V1_PROJECTION_REQUIRED");
    return mapped;
  };
}
