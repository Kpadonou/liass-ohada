import type { TransactionScope } from "./transaction-model";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { mapRestaurantFiscalLines } from "./fiscal-line-mapper";
import { verifyRestaurantIssuanceProvenance } from "./issuance-provenance";

type SourceResult = Awaited<
  ReturnType<typeof RestaurantInvoiceSourceVerifier.verify>
>;
type SourceReader = typeof RestaurantInvoiceSourceVerifier.verify;

/** Read-only preparation over an authorized FINAL source. Provenance must be
 * supplied from the immutable issuance record; current configuration is never used.
 */
export async function prepareRestaurantFiscalInvoice(
  input: {
    scope: TransactionScope;
    actorId: string;
    sessionId: string;
    invoiceId: string;
    classifications: unknown;
    issuanceProvenance?: unknown;
  },
  verifySource: SourceReader = RestaurantInvoiceSourceVerifier.verify,
) {
  const source: SourceResult = await verifySource(
    input.scope,
    input.actorId,
    input.sessionId,
    input.invoiceId,
  );
  if (!source.verified)
    return { ready: false as const, reason: source.denial.code };

  const { evidence } = source;
  const provenance = verifyRestaurantIssuanceProvenance(
    evidence.issuanceProvenance?.verified
      ? evidence.issuanceProvenance.evidence
      : undefined,
    {
      orgId: evidence.source.orgId,
      outletId: evidence.source.outletId,
      invoiceId: evidence.source.invoiceId,
      guestSessionId: evidence.source.guestSessionId,
      commercialRootDigest: evidence.proof.digest,
      issuedAt: evidence.invoice.issuedAt,
    },
  );
  if (!provenance.verified)
    return { ready: false as const, reason: provenance.reason };

  try {
    const mapping = mapRestaurantFiscalLines({
      lines: evidence.lines.map(({ line }) => line),
      classifications: input.classifications,
    });
    if (
      evidence.lines.length !== evidence.invoice.lineCount ||
      mapping.currency !== evidence.invoice.currency ||
      BigInt(mapping.totalMinor) !== BigInt(evidence.invoice.dueMinor) ||
      evidence.invoice.dueMinor !== evidence.invoice.paidMinor
    )
      return {
        ready: false as const,
        reason: "SOURCE_AMOUNT_MISMATCH" as const,
      };

    return {
      ready: true as const,
      preparation: {
        schemaVersion: 1 as const,
        source: evidence.source,
        commercialRootDigest: evidence.proof.digest,
        issuedAt: evidence.invoice.issuedAt,
        provenance: provenance.evidence,
        paidByMethodMinor: evidence.invoice.paidByMethodMinor,
        currency: mapping.currency,
        totalMinor: mapping.totalMinor,
        lines: mapping.lines,
        providerMutationEnabled: false as const,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "INVALID_MAPPING";
    return {
      ready: false as const,
      reason: [
        "AMBIGUOUS_FISCAL_CLASSIFICATION",
        "DUPLICATE_COMMERCIAL_LINE",
        "MISSING_FISCAL_CLASSIFICATION",
        "UNSUPPORTED_COMMERCIAL_LINE",
        "UNKNOWN_CLASSIFIED_LINE",
        "MIXED_CURRENCIES",
      ].includes(reason)
        ? reason
        : "INVALID_MAPPING",
    };
  }
}
