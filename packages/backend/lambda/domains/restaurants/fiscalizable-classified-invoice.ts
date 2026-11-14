import { canonical, clean, hash } from "@/lambda/shared/authority/integrity";
import {
  identifierDigest,
  tzdbDigest,
} from "@/lambda/shared/authority/iana-pinned-digests";
import type { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { validRestaurantSaleTax } from "./pilot-tax-calculation";
import { restaurantQuantityAmountMinor } from "@liass-ohada/shared/restaurant-quantity";

type Source = Extract<
  Awaited<ReturnType<typeof RestaurantInvoiceSourceVerifier.verify>>,
  { verified: true }
>["evidence"];
const bytes = (kind: string, payload: unknown) =>
  canonical({ profile: "LIASS-FISCAL-C14N-1", version: 1, kind, payload });

/** New classified invoices; the legacy ordinary-VAT projection remains byte-stable. */
export function projectRestaurantClassifiedInvoice(evidence: Source) {
  const { invoice, source, proof, lines, parts, issuanceProvenance } = evidence;
  if (
    !issuanceProvenance.verified ||
    issuanceProvenance.evidence.evidenceOrigin !== "AUTHENTIC" ||
    invoice.currency !== "XOF" ||
    !lines.length ||
    lines.length > 100 ||
    invoice.paidMinor !== invoice.dueMinor ||
    !invoice.paymentCount
  )
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
  const provenance = issuanceProvenance.evidence;
  if (
    provenance.timezone.timezone !== "Africa/Porto-Novo" ||
    provenance.timezone.tzdbArtifactDigest !== tzdbDigest ||
    provenance.timezone.acceptedIdentifierArtifactDigest !== identifierDigest ||
    !/^20[2-9]\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(provenance.issuedAt)
  )
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
  const seller = clean(provenance.seller.seller);
  const identifiers = [...seller.identifiers].sort((a, b) =>
    canonical(a).localeCompare(canonical(b)),
  );
  if (
    new Set(identifiers.map(canonical)).size !== identifiers.length ||
    seller.country !== "BJ"
  )
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
  const sourceIdentity = {
    domain: "RESTAURANTS",
    documentType: "INVOICE",
    documentId: source.invoiceId,
  } as const;
  const sourceProof = { algorithm: proof.algorithm, digest: proof.digest };
  const sourceProofFingerprint = hash(
    bytes("source-proof", {
      orgId: source.orgId,
      source: sourceIdentity,
      sourceRevision: String(source.sourceVersion),
      proofAlgorithm: proof.algorithm,
      proofDigest: proof.digest,
    }),
  );
  const included = [] as Array<{
    lineId: string;
    coordinates: unknown[];
    allocatedQuantity: string;
    allocatedTotalMinor: string;
  }>;
  let net = 0n,
    tax = 0n,
    total = 0n;
  const documentLines = lines.map(({ line, coordinate }, position) => {
    const snapshot = line.snapshot;
    const treatment = snapshot.fiscalTreatment;
    if (
      !treatment ||
      line.cancelledAt ||
      snapshot.discountMinor !== 0 ||
      !validRestaurantSaleTax(snapshot) ||
      snapshot.currency !== "XOF" ||
      snapshot.lineTotalMinor !== line.netAmountMinor ||
      restaurantQuantityAmountMinor(
        snapshot.unitPriceMinor,
        snapshot.quantity,
      ) !== snapshot.lineTotalMinor ||
      ((treatment.effectiveGroup === "C" ||
        treatment.effectiveGroup === "D" ||
        (treatment.regime === "TPS" && treatment.effectiveGroup === "B")) &&
        !treatment.evidenceReference)
    )
      throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
    const lineId = `${coordinate.orderId}_${coordinate.itemId}`;
    included.push({
      lineId,
      coordinates: [
        [
          lineId,
          true,
          coordinate.orderId,
          true,
          coordinate.itemId,
          true,
          coordinate.partNumber,
          true,
          coordinate.position,
        ],
      ],
      allocatedQuantity: String(snapshot.quantity),
      allocatedTotalMinor: String(snapshot.lineTotalMinor),
    });
    net += BigInt(snapshot.subtotalMinor);
    tax += BigInt(snapshot.taxMinor);
    total += BigInt(snapshot.lineTotalMinor);
    return {
      lineId,
      sourceCoordinates: [{ sourceLineId: lineId, ...coordinate }],
      lineKind: "ITEM" as const,
      fiscalTreatmentEvidence: {
        reference: treatment.evidenceReference ?? treatment.regimeRevision,
        version: String(treatment.policyVersion),
        catalogGroup: treatment.catalogGroup,
        effectiveGroup: treatment.effectiveGroup,
        regime: treatment.regime,
        regimeRevision: treatment.regimeRevision,
      },
      position,
      description: snapshot.name,
      quantity: String(snapshot.quantity),
      unitPrice: String(snapshot.unitPriceMinor),
      priceBasis: "INCLUDING_TAX" as const,
      discount: { basis: "INCLUDING_TAX" as const, amountMinor: "0" },
      netMinor: String(snapshot.subtotalMinor),
      taxes: treatment.rateBasisPoints
        ? [
            {
              taxId: "VAT",
              kind: "VAT" as const,
              label: "TVA",
              ratePercent: "18",
              basisMinor: String(snapshot.subtotalMinor),
              amountMinor: String(snapshot.taxMinor),
              effect: "ADDED_TO_NET" as const,
            },
          ]
        : [],
      totalMinor: String(snapshot.lineTotalMinor),
    };
  });
  if (total !== BigInt(invoice.dueMinor) || net + tax !== total)
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
  const projectionEvidence = {
    sourceProofFingerprint,
    projectionVersion: "RESTO-BJ-CLASSIFIED-1",
    projectionRevision: 1,
    included,
    excluded: [],
  };
  const definition =
    canonical({
      policyId: "BJ-RESTO-TTC",
      version: 1,
      formula: "vat=round_half_up_line(gross*rate/(10000+rate));net=gross-vat",
      currency: "XOF",
      minorUnitScale: 0,
      discount: "REJECT",
      scope: "LINE",
    }) + "\n";
  const definitionDigest = hash(
    bytes("calculation-definition", {
      policyId: "BJ-RESTO-TTC",
      policyVersion: "1",
      definitionFormat: "LIASS-CALCULATION-SPEC-UTF8-1",
      definitionBytesDigest: hash(definition),
      currencyRegistryDigest: hash(
        canonical({
          version: 1,
          currencies: [{ code: "XOF", minorUnitScale: 0 }],
        }),
      ),
    }),
  );
  const payload = {
    schemaVersion: 1 as const,
    kind: "INVOICE" as const,
    orgId: source.orgId,
    source: sourceIdentity,
    sourceRevision: String(source.sourceVersion),
    sourceProof,
    projectionVersion: projectionEvidence.projectionVersion,
    projectionRevision: 1,
    projectionEvidenceDigest: hash(
      bytes("projection-evidence", projectionEvidence),
    ),
    canonicalizationProfile: "LIASS-FISCAL-C14N-1",
    issuedAt: provenance.issuedAt,
    issueDate: new Date(Date.parse(provenance.issuedAt) + 3600000)
      .toISOString()
      .slice(0, 10),
    issueTimezone: provenance.timezone.timezone,
    issuanceEvidence: {
      event: provenance.event,
      reference: source.invoiceId,
      digest: provenance.bindingDigest,
      timezoneSourceReference: provenance.timezone.reference,
    },
    currency: { code: "XOF", minorUnitScale: 0 },
    seller: { ...seller, identifiers },
    sellerProvenance: {
      identityReference: provenance.seller.identityReference,
      identityVersion: provenance.seller.identityVersion,
      identityDigest: provenance.seller.identityDigest,
      capturedAt: provenance.capturedAt,
      issuanceEventReference: source.invoiceId,
    },
    buyer: { kind: "UNIDENTIFIED" as const },
    calculationPolicy: {
      id: "BJ-RESTO-TTC",
      version: "1",
      definitionDigest,
      rounding: "HALF_UP_LINE",
      scope: "LINE" as const,
    },
    lines: documentLines,
    totals: {
      netMinor: String(net),
      taxMinor: String(tax),
      totalMinor: String(total),
    },
  };
  const document = {
    ...payload,
    snapshotDigest: hash(bytes("snapshot", payload)),
  };
  const limits = {
    envelopeBytes: Buffer.byteLength(canonical(document)),
    projectionBytes: Buffer.byteLength(canonical(projectionEvidence)),
    sourcePartBytes: parts.reduce(
      (sum, part) => sum + Buffer.byteLength(JSON.stringify(part)),
      0,
    ),
  };
  if (
    limits.envelopeBytes > 358400 ||
    limits.projectionBytes > 358400 ||
    limits.sourcePartBytes > 8 * 1024 * 1024
  )
    throw new Error("RESTAURANTS_V1_LIMIT");
  return { document, projectionEvidence, sourceProofFingerprint, limits };
}
