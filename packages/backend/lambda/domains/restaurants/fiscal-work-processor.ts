import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { FiscalTestExecutionAuthorizationService } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { RestaurantFiscalWorkRepository } from "./fiscal-work-repository";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { projectRestaurantInvoiceV1 } from "./fiscalizable-invoice-v1";
import { realTestFiscalService } from "./real-test-fiscal-handler";

type Work = { orgId: string; outletId: string; sessionId: string;
  invoiceId: string; actorId: string; createdAt: string };

/** One committed intent. All provider commands remain owned by the fiscal service. */
export class RestaurantFiscalWorkProcessor {
  static async process(work: Work) {
    const claim = await RestaurantFiscalWorkRepository.claim(work);
    const context = { orgId: work.orgId, userId: work.actorId };
    const request = { outletId: work.outletId, sessionId: work.sessionId, invoiceId: work.invoiceId };
    if (!claim) {
      try {
        const result = await realTestFiscalService.confirmedResult(context, request);
        if (result.status === "CONFIRMED" && result.securityElements && result.evidenceOrigin === "DGI_TEST") {
          await RestaurantFiscalWorkRepository.settleConfirmed(work);
          return { state: "CONFIRMED" as const };
        }
      } catch { /* An unresolved attempt stays visible for guarded recovery. */ }
      return { state: "NOT_CLAIMED" as const };
    }
    try {
      const source = await RestaurantInvoiceSourceVerifier.verify(
        { orgId: work.orgId, outletId: work.outletId }, work.actorId,
        work.sessionId, work.invoiceId,
      );
      if (!source.verified) throw new Error("FISCAL_SOURCE_UNAVAILABLE");
      projectRestaurantInvoiceV1(source.evidence);
      if (!realFiscalTestEnabled()) throw new Error("FISCAL_GATE_DISABLED");
      await FiscalTestExecutionAuthorizationService.readBound({
        orgId: work.orgId, outletId: work.outletId, operatorUserId: work.actorId,
        sessionId: work.sessionId, invoiceId: work.invoiceId,
        sourceDigest: source.evidence.proof.digest,
      });
    } catch {
      await RestaurantFiscalWorkRepository.block(work, claim);
      return { state: "BLOCKED" as const };
    }
    const attemptId = `AUTO#${work.invoiceId}`;
    try {
      const created = await realTestFiscalService.initiate(context, {
        ...request, attemptId, commandId: `${attemptId}#CREATE`,
      });
      if (created.status !== "CREATED") return { state: created.status };
      await realTestFiscalService.recover(context, { ...request, providerOperation: "RECONCILE" });
      const confirmed = await realTestFiscalService.confirm(context, {
        ...request, commandId: `${attemptId}#CONFIRM`, confirm: true,
      });
      if (confirmed.status === "CONFIRMED" && confirmed.securityElements &&
        confirmed.evidenceOrigin === "DGI_TEST") {
        await RestaurantFiscalWorkRepository.complete(work, claim);
      } else if (confirmed.status === "CONFIRMED") {
        return { state: "UNRESOLVED" as const };
      }
      return { state: confirmed.status };
    } catch {
      // The fiscal attempt is authoritative. Never retry a provider mutation here.
      return { state: "UNRESOLVED" as const };
    }
  }
}
