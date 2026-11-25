import { createHash } from "node:crypto";
import { FiscalAttemptState } from "./fiscal-attempt-state";

/** The original security payload is retained verbatim. A printed NIM/counter
 * reference and a provider request reference have different provenance. */
export function confirmedCreditOriginal(original: FiscalAttemptState, scope: {
  orgId: string; sourceDomain: string; sourceDocumentId: string; sourceDigest: string;
}) {
  if (original.identity.orgId !== scope.orgId || original.identity.sourceDomain !== scope.sourceDomain ||
    original.identity.sourceDocumentId !== scope.sourceDocumentId || original.identity.sourceDocumentType !== "INVOICE" ||
    original.identity.environment !== "TEST" || original.status !== "CONFIRMED" ||
    original.execution !== "REAL_TEST" || original.securityEvidenceOrigin !== "DGI_TEST" ||
    original.sourceDigest !== scope.sourceDigest || !original.security ||
    !["FV", "EV"].includes(original.fiscalDocumentType ?? ""))
    throw new Error("ORIGINAL_FISCAL_CERTIFICATION_REQUIRED");
  const security = structuredClone(original.security);
  // Only the documented counter structure is understood. Never guess a counter
  // from the commercial invoice number or use it in the API reference field.
  const counters = /^(\d+)\s*\/\s*(\d+)\s+(FV|EV)$/.exec(security.counters);
  const printedReference = counters && counters[3] === original.fiscalDocumentType
    ? `${security.nim} - ${counters[2]}` : undefined;
  const evidenceDigest = createHash("sha256").update(JSON.stringify({
    obligationId: original.obligationId, sourceDigest: original.sourceDigest,
    type: original.fiscalDocumentType, security,
  })).digest("hex");
  return { originalObligationId: original.obligationId, sourceDigest: original.sourceDigest,
    originalType: original.fiscalDocumentType as "FV" | "EV",
    creditType: original.fiscalDocumentType === "FV" ? "FA" as const : "EA" as const,
    security, evidenceDigest, printedReference };
}

export type ConfirmedCreditOriginal = ReturnType<typeof confirmedCreditOriginal>;
/** A raw 24-character original code is already representable. Formatted codes
 * are deliberately not transformed. A future governed provider mapping must be
 * bound to this exact original evidence before it can add another encoding. */
export function originalCreditWireReference(original: ConfirmedCreditOriginal): string {
  const code = original.security.codeMECeFDGI;
  if (code.length !== 24 || /[\s-]/.test(code))
    throw new Error("FISCAL_ORIGINAL_REFERENCE_MAPPING_REQUIRED");
  return code;
}

/** Signed receipt projection only. Provider requests and positive commercial
 * credit-limit magnitudes are never changed by presentation. */
export function signedCreditReceipt(input: {
  original: ConfirmedCreditOriginal;
  lines: readonly { quantity: number; amountMinor: number; taxMinor: number; taxGroup: string }[];
  security: FiscalAttemptState["security"];
  evidenceOrigin: FiscalAttemptState["securityEvidenceOrigin"];
}) {
  if (!input.security || input.evidenceOrigin !== "DGI_TEST" ||
    input.security.codeMECeFDGI === input.original.security.codeMECeFDGI ||
    input.security.qrCode === input.original.security.qrCode || !input.lines.length)
    throw new Error("CREDIT_FISCAL_CONFIRMATION_REQUIRED");
  if (!input.original.printedReference) throw new Error("FISCAL_ORIGINAL_PRINT_REFERENCE_REQUIRED");
  const groups: Record<string, { netMinor: number; taxMinor: number; totalMinor: number }> = {};
  let total = 0n;
  const signed = input.lines.map(line => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 ||
      !Number.isSafeInteger(line.amountMinor) || !Number.isSafeInteger(line.taxMinor) ||
      line.amountMinor < 0 || line.taxMinor < 0 || line.taxMinor > line.amountMinor ||
      !["A", "B", "C", "D", "E"].includes(line.taxGroup)) throw new Error("INVALID_CREDIT_RECEIPT_LINE");
    const group = groups[line.taxGroup] ??= { netMinor: 0, taxMinor: 0, totalMinor: 0 };
    group.netMinor -= line.amountMinor - line.taxMinor; group.taxMinor -= line.taxMinor;
    group.totalMinor -= line.amountMinor; total += BigInt(line.amountMinor);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("INVALID_CREDIT_RECEIPT_LINE");
    return { ...line, quantity: -line.quantity, amountMinor: -line.amountMinor,
      taxMinor: line.taxMinor === 0 ? 0 : -line.taxMinor };
  });
  return { type: input.original.creditType, originalReference: input.original.printedReference,
    originalEvidence: structuredClone(input.original), lines: signed, groups,
    totalMinor: -Number(total), security: structuredClone(input.security), evidenceOrigin: input.evidenceOrigin };
}
