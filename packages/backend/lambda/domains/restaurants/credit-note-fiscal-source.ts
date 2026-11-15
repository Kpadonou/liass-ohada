import { createHash } from "node:crypto";
import { AppError } from "@/lambda/shared/app-error";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import { RestaurantCreditNoteService } from "./credit-note-service";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import type { TransactionScope } from "./transaction-model";

/** Authenticated Restaurants-owned read of one persisted, validated credit note.
 * The original FINAL chain and all current credit controls are rechecked before
 * any fiscal reservation. No caller can supply a fiscal reference or type. */
export class RestaurantCreditNoteFiscalSource {
  static async verify(scope: TransactionScope, actorId: string, sessionId: string,
    invoiceId: string, creditNoteId: string) {
    const credit = await RestaurantCreditNoteService.detail(scope, actorId, creditNoteId);
    const note = credit.data;
    if (note.status !== "VALIDATED" || note.guestSessionId !== sessionId ||
      note.finalBillId !== invoiceId || note.orgId !== scope.orgId ||
      note.outletId !== scope.outletId)
      throw new AppError(409, "FISCAL_SOURCE_MISMATCH");
    const original = await RestaurantInvoiceSourceVerifier.verify(scope, actorId, sessionId, invoiceId);
    if (!original.verified || original.evidence.invoice.digest !== note.sourceReceiptDigest ||
      original.evidence.invoice.currency !== note.currency ||
      original.evidence.proof.digest.length !== 64)
      throw new AppError(409, "FISCAL_SOURCE_UNAVAILABLE");
    const source = original.evidence;
    const fiscalIdentity = { orgId: scope.orgId, environment: "TEST" as const,
      sourceDomain: "restaurants", sourceDocumentType: "INVOICE",
      sourceDocumentId: invoiceId, jurisdiction: "BJ", obligation: "NORMALIZE" };
    const originalFiscal = await new FiscalAttemptStore().read(fiscalIdentity);
    if (originalFiscal?.status !== "CONFIRMED" || originalFiscal.execution !== "REAL_TEST" ||
      originalFiscal.securityEvidenceOrigin !== "DGI_TEST" ||
      originalFiscal.sourceDigest !== source.proof.digest ||
      !["FV", "EV"].includes(originalFiscal.fiscalDocumentType ?? "") ||
      !originalFiscal.security || originalFiscal.security.codeMECeFDGI.length !== 24)
      throw new AppError(409, "ORIGINAL_FISCAL_CERTIFICATION_REQUIRED");
    const controls = await RestaurantCreditNoteService.creditability(scope, sessionId);
    if (controls.finalBillId !== invoiceId || controls.currency !== note.currency ||
      controls.originalAmountMinor !== source.invoice.dueMinor ||
      credit.lines.some(line => {
        const control = controls.lines.find(v => v.orderId === line.orderId && v.itemId === line.itemId);
        const originalLine = source.lines.find(v => v.coordinate.orderId === line.orderId &&
          v.coordinate.itemId === line.itemId)?.line;
        return !control || !originalLine ||
          control.creditedQuantity < line.creditedQuantity ||
          control.creditedAmountMinor < line.creditedAmountMinor ||
          originalLine.snapshot.quantity !== line.originalQuantity ||
          originalLine.netAmountMinor !== line.originalNetAmountMinor ||
          originalLine.snapshot.unitPriceMinor !== line.unitAmountMinor;
      }))
      throw new AppError(409, "FISCAL_SOURCE_MISMATCH");
    const sourceDigest = createHash("sha256").update(JSON.stringify({
      version: 1, orgId: scope.orgId, outletId: scope.outletId,
      originalProofDigest: source.proof.digest,
      originalFiscalObligationId: originalFiscal.obligationId,
      originalFiscalType: originalFiscal.fiscalDocumentType,
      originalFiscalCode: originalFiscal.security.codeMECeFDGI,
      note, lines: credit.lines,
    })).digest("hex");
    return { credit, original: source, originalFiscal, sourceDigest };
  }
}
