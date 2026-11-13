import {
  identifierDigest,
  tzdbDigest,
} from "@/lambda/shared/authority/iana-pinned-digests";
import { canonical, clean, hash } from "@/lambda/shared/authority/integrity";
import type { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { validRestaurantSaleTax } from "./pilot-tax-calculation";
import { projectRestaurantClassifiedInvoice } from "./fiscalizable-classified-invoice";

type VerifiedSource = Extract<
  Awaited<ReturnType<typeof RestaurantInvoiceSourceVerifier.verify>>,
  { verified: true }
>["evidence"];

const profile = "LIASS-FISCAL-C14N-1";
function bytes(kind: string, payload: unknown) {
  return canonical({ profile, version: 1, kind, payload });
}

/** The first V1 case is an ordinary Benin VAT invoice with one unit and one cash
 * settlement. Commercial verification precedes this read-only projection. */
export function projectRestaurantInvoiceV1(evidence: VerifiedSource) {
  if (evidence.lines.some(({ line }) => line.snapshot.fiscalTreatment))
    return projectRestaurantClassifiedInvoice(evidence);
  const { invoice, source, proof, lines, parts, issuanceProvenance } = evidence;
  if (
    !issuanceProvenance.verified ||
    issuanceProvenance.evidence.evidenceOrigin !== "AUTHENTIC" ||
    invoice.currency !== "XOF" ||
    lines.length !== 1 ||
    invoice.paymentCount !== 1 ||
    invoice.paidMinor !== invoice.dueMinor ||
    invoice.paidByMethodMinor.CASH !== invoice.dueMinor
  )
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
  const provenance = issuanceProvenance.evidence;
  const { line, coordinate } = lines[0];
  const { snapshot } = line;
  const tax = snapshot.ordinaryTax;
  if (
    !tax ||
    snapshot.quantity !== 1 ||
    line.cancelledAt ||
    snapshot.discountMinor !== 0 ||
    !validRestaurantSaleTax(snapshot) ||
    snapshot.lineTotalMinor !== invoice.dueMinor ||
    provenance.seller.seller.country !== tax.policy.profile.country ||
    provenance.timezone.timezone !== "Africa/Porto-Novo" ||
    provenance.timezone.tzdbArtifactDigest !== tzdbDigest ||
    provenance.timezone.acceptedIdentifierArtifactDigest !== identifierDigest ||
    !/^20[2-9]\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(provenance.issuedAt)
  )
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");

  // The supported modern Porto-Novo case has a fixed UTC+01 offset.
  const issueDate = new Date(Date.parse(provenance.issuedAt) + 3600000)
    .toISOString()
    .slice(0, 10);
  const sourceIdentity = {
    domain: "RESTAURANTS",
    documentType: "INVOICE",
    documentId: source.invoiceId,
  } as const;
  const sourceRevision = String(source.sourceVersion);
  const sourceProof = { algorithm: proof.algorithm, digest: proof.digest };
  const sourceProofFingerprint = hash(
    bytes("source-proof", {
      orgId: source.orgId,
      source: sourceIdentity,
      sourceRevision,
      proofAlgorithm: sourceProof.algorithm,
      proofDigest: sourceProof.digest,
    }),
  );
  const lineId = `${coordinate.orderId}_${coordinate.itemId}`;
  const totalMinor = String(snapshot.lineTotalMinor);
  const projectionVersion = "RESTO-ORDINARY-VAT-1";
  const projectionRevision = 1;
  const projectionEvidence = {
    sourceProofFingerprint,
    projectionVersion,
    projectionRevision,
    included: [
      {
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
        allocatedQuantity: "1",
        allocatedTotalMinor: totalMinor,
      },
    ],
    excluded: [],
  };
  const projectionBytes = bytes("projection-evidence", projectionEvidence);
  const currency = {
    code: tax.policy.currency,
    minorUnitScale: tax.policy.minorUnitScale,
  };
  const definition =
    canonical({
      ...tax.policy,
      formula:
        "gross=unitPrice*quantity; net=gross*10000/(10000+rate); tax=gross-net",
      discount: "REJECT",
      residual: "REJECT",
      compounding: "NONE",
      scope: "LINE",
    }) + "\n";
  const definitionDigest = hash(
    bytes("calculation-definition", {
      policyId: tax.policy.id,
      policyVersion: String(tax.policy.version),
      definitionFormat: "LIASS-CALCULATION-SPEC-UTF8-1",
      definitionBytesDigest: hash(definition),
      currencyRegistryDigest: hash(
        canonical({ version: 1, currencies: [currency] }),
      ),
    }),
  );
  const seller = clean(provenance.seller.seller);
  const identifiers = [...seller.identifiers].sort((a, b) => {
    const aKey = [a.scheme, a.issuingCountry ?? "", a.value];
    const bKey = [b.scheme, b.issuingCountry ?? "", b.value];
    for (const [index, value] of aKey.entries()) {
      if (value !== bKey[index]) return value < bKey[index] ? -1 : 1;
    }
    return 0;
  });
  if (
    new Set(identifiers.map((identifier) => canonical(identifier))).size !==
    identifiers.length
  )
    throw new Error("RESTAURANTS_V1_CASE_UNSUPPORTED");
  const netMinor = String(snapshot.subtotalMinor);
  const taxMinor = String(snapshot.taxMinor);
  const payload = {
    schemaVersion: 1 as const,
    kind: "INVOICE" as const,
    orgId: source.orgId,
    source: sourceIdentity,
    sourceRevision,
    sourceProof,
    projectionVersion,
    projectionRevision,
    projectionEvidenceDigest: hash(projectionBytes),
    canonicalizationProfile: profile,
    issuedAt: provenance.issuedAt,
    issueDate,
    issueTimezone: provenance.timezone.timezone,
    issuanceEvidence: {
      event: provenance.event,
      reference: source.invoiceId,
      digest: provenance.bindingDigest,
      timezoneSourceReference: provenance.timezone.reference,
    },
    currency,
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
      id: tax.policy.id,
      version: String(tax.policy.version),
      definitionDigest,
      rounding: tax.policy.rounding,
      scope: "LINE" as const,
    },
    lines: [
      {
        lineId,
        sourceCoordinates: [{ sourceLineId: lineId, ...coordinate }],
        lineKind: "ITEM" as const,
        fiscalTreatmentEvidence: {
          reference: tax.profileRevision,
          version: String(tax.policy.profile.rule.version),
        },
        position: 0,
        description: snapshot.name,
        quantity: "1",
        unitPrice: String(snapshot.unitPriceMinor),
        priceBasis: tax.policy.priceBasis,
        discount: { basis: tax.policy.priceBasis, amountMinor: "0" },
        netMinor,
        taxes: [
          {
            taxId: "VAT",
            kind: "VAT" as const,
            label: "TVA",
            ratePercent: "18",
            basisMinor: netMinor,
            amountMinor: taxMinor,
            effect: "ADDED_TO_NET" as const,
          },
        ],
        totalMinor,
      },
    ],
    totals: { netMinor, taxMinor, totalMinor },
  };
  const document = {
    ...payload,
    snapshotDigest: hash(bytes("snapshot", payload)),
  };
  const limits = {
    envelopeBytes: Buffer.byteLength(canonical(document)),
    projectionBytes: Buffer.byteLength(projectionBytes),
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
