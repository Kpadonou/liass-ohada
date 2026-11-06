import { createHash } from "node:crypto";
import { canonical, clean } from "@/lambda/shared/authority/integrity";
import type {
  FiscalPrincipal,
  VerifiedFiscalPreparation,
} from "../fiscal-compliance/core/synthetic-fiscal-orchestrator";
import type { FiscalObligationIdentity } from "../fiscal-compliance/core/fiscal-attempt-state";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
/** Trusted producer boundary. No caller-supplied preparation/provenance is accepted. */
export function restaurantSyntheticPreparation(
  outletId: string,
  sessionId: string,
  classifications: unknown,
  prepare = prepareRestaurantFiscalInvoice,
) {
  return async (
    principal: FiscalPrincipal,
    identity: FiscalObligationIdentity,
  ): Promise<VerifiedFiscalPreparation> => {
    if (
      principal.orgId !== identity.orgId ||
      identity.sourceDomain !== "restaurants" ||
      identity.sourceDocumentType !== "INVOICE" ||
      identity.environment !== "TEST"
    )
      throw new Error("FISCAL_SOURCE_SCOPE_DENIED");
    const result = await prepare({
      scope: { orgId: principal.orgId, outletId },
      actorId: principal.actorId,
      sessionId,
      invoiceId: identity.sourceDocumentId,
      classifications,
    });
    if (!result.ready) throw new Error("FISCAL_PREPARATION_UNAVAILABLE");
    const payload = result.preparation;
    const total = Number(payload.totalMinor);
    if (
      !Number.isSafeInteger(total) ||
      BigInt(total) !== BigInt(payload.totalMinor) ||
      total <= 0
    )
      throw new Error("FISCAL_AMOUNT_UNSUPPORTED");
    return {
      identity,
      sourceDigest: payload.commercialRootDigest,
      requestDigest: createHash("sha256")
        .update(canonical(clean(payload)))
        .digest("hex"),
      total,
      payload,
    };
  };
}
