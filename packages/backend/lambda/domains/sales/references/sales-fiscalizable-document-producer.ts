import {
  SalesInvoiceSchema,
  SalesCreditNoteSchema,
} from "@liass-ohada/shared/sales";
import { verifyIssuedAuthority } from "../authority/sales-issuance-authority-service";
import { SalesInvoiceCalculator } from "../invoices/sales-invoice-calculator";
import {
  admission,
  canonical,
  clean,
  hash,
} from "@/lambda/shared/authority/integrity";

/** D04 is OPEN. These requirements cannot be supplied by a caller's approval boolean. */
export const SALES_V1_D04_BLOCKERS = Object.freeze([
  "SOURCE_PROOF_ALGORITHM_AND_PUBLICATION_BINDING",
  "PROJECTION_VERSION_REVISION_AND_COORDINATE_EVIDENCE",
  "LINE_KIND_AND_FISCAL_TREATMENT_EVIDENCE",
  "COMMERCIAL_TAX_COMPONENT_IDENTITY_AND_TREATMENT",
] as const);

/**
 * SALES-owned internal candidate boundary. Never registered or called by a customer route.
 * Until D04 is decided it emits source evidence or a denial, NEVER a partial/complete V1 document.
 * Diagnostic source hashes below are not a source-proof algorithm or a fiscal snapshot digest.
 */
export class SalesFiscalizableDocumentProducer {
  static inspect(input: {
    orgId: string;
    documentType: "INVOICE" | "CREDIT_NOTE";
    source: unknown;
    originalInvoice?: unknown;
  }) {
    const deny = (reason: string) => ({
      status: "INELIGIBLE" as const,
      reason,
    });
    const parsed =
      input.documentType === "INVOICE"
        ? SalesInvoiceSchema.safeParse(input.source)
        : SalesCreditNoteSchema.safeParse(input.source);
    if (!parsed.success)
      return deny("INVALID_OR_UNSUPPORTED_COMMERCIAL_SOURCE");
    const source = parsed.data;
    if (source.status !== "ISSUED") return deny("DRAFT_SOURCE");
    try {
      // Supplementary decoded-source admission check; actual persisted item bytes are independently measured by its owner.
      admission(source, 358400);
      verifyIssuedAuthority(source, input.orgId);
      const snapshot = source.issuanceAuthoritySnapshot!;
      if (snapshot.documentType !== input.documentType)
        return deny("SOURCE_TYPE_BINDING_MISMATCH");
      if (
        source.lines.length > 100 ||
        source.lines.some((l) => l.id.length > 200 || l.position > 999) ||
        new Set(source.lines.map((l) => l.id)).size !== source.lines.length ||
        new Set(source.lines.map((l) => l.position)).size !==
          source.lines.length
      )
        return deny("SOURCE_BOUNDS_OR_COORDINATE_CONFLICT");
      if ("originalInvoiceId" in source) {
        const original = SalesInvoiceSchema.safeParse(input.originalInvoice);
        if (!original.success || original.data.status !== "ISSUED")
          return deny("ORIGINAL_ISSUED_SOURCE_REQUIRED");
        verifyIssuedAuthority(original.data, input.orgId);
        const reference = `${original.data.id}:${original.data.issuanceAuthorityDigest}`;
        if (
          original.data.id !== source.originalInvoiceId ||
          original.data.invoiceNumber !== source.originalInvoiceNumber ||
          original.data.currency !== source.currency ||
          original.data.issuanceAuthoritySnapshot!.sellerAuthority
            .legalEntityReference !==
            snapshot.sellerAuthority.legalEntityReference ||
          canonical(original.data.calculationBinding) !==
            canonical(source.calculationBinding) ||
          snapshot.originalSellerEvidenceReference !== reference ||
          snapshot.originalCalculationBindingReference !== reference ||
          source.lines.some(
            (l) =>
              !original.data.lines.some(
                (o) => o.id === l.originalInvoiceLineId,
              ),
          )
        )
          return deny("ORIGINAL_AUTHORITY_OR_LINE_CONTINUITY_MISMATCH");
      }
      const minor = (v: string) =>
        SalesInvoiceCalculator.toMinorUnits(
          source.currency,
          v,
          source.calculationBinding,
        );
      const sums = source.lines.reduce(
        (a, l) => ({
          net: a.net + BigInt(minor(l.subtotal)),
          tax: a.tax + BigInt(minor(l.taxAmount)),
          total: a.total + BigInt(minor(l.total)),
        }),
        { net: 0n, tax: 0n, total: 0n },
      );
      if (
        source.lines.some(
          (l) =>
            BigInt(minor(l.subtotal)) + BigInt(minor(l.taxAmount)) !==
            BigInt(minor(l.total)),
        ) ||
        sums.net.toString() !== minor(source.subtotal) ||
        sums.tax.toString() !== minor(source.taxTotal) ||
        sums.total.toString() !== minor(source.total)
      )
        return deny("PERSISTED_AMOUNT_INCONSISTENCY");
      if (source.lines.some((l) => /^0(?:\.0+)?$/.test(l.unitPrice)))
        return deny("ZERO_PRICE_JUSTIFICATION_AND_TREATMENT_MISSING");
      const sourceCopy = clean(source);
      return {
        status: "BLOCKED_BY_D04" as const,
        source: {
          documentType: input.documentType,
          documentId: source.id,
          version: source.version,
        },
        frozenCommercialSource: sourceCopy,
        persistedAmountsMinor: {
          net: minor(source.subtotal),
          tax: minor(source.taxTotal),
          total: minor(source.total),
        },
        // This labels owner evidence only; it is not any of the five fiscal fingerprint types.
        diagnosticSourceJsonSha256: hash(canonical(sourceCopy)),
        sourceJsonUtf8Bytes: Buffer.byteLength(
          JSON.stringify(sourceCopy),
          "utf8",
        ),
        blockingRequirements: [
          ...SALES_V1_D04_BLOCKERS,
          ...(input.documentType === "CREDIT_NOTE"
            ? ["ORIGINAL_SOURCE_PROOF_BINDING"]
            : []),
        ],
        fiscalCurrencyReadiness:
          "NOT_ESTABLISHED_BY_COMMERCIAL_COMPATIBILITY_POLICY" as const,
      };
    } catch {
      // No raw source, artifact, Zod detail or private identity is included in a denial.
      return deny("ISSUANCE_AUTHORITY_POLICY_OR_SIZE_INVALID");
    }
  }
}
