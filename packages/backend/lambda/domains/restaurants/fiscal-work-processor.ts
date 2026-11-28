import { automaticFiscalPolicy, automaticFiscalEligible, prepareAutomaticFiscalAuthorization } from "./automatic-fiscal-policy";
import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { FiscalTestExecutionAuthorizationService } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { RestaurantFiscalWorkRepository } from "./fiscal-work-repository";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { projectRestaurantInvoiceV1 } from "./fiscalizable-invoice-v1";
import { realTestFiscalService } from "./real-test-fiscal-handler";
import { prepareBoundRestaurantWorkflow } from "./bound-fiscal-workflow";
import type { FiscalIssuanceBinding } from "@liass-ohada/shared/shared";

const knownPreReservationFailure = new Set([
  "FISCAL_SELLER_IDENTITY_INCOMPLETE", "FISCAL_SELLER_IFU_UNVERIFIED",
  "FISCAL_PREPARATION_UNAVAILABLE", "FISCAL_SOURCE_MISMATCH",
  "FISCAL_MAPPING_EVIDENCE_MISSING", "FISCAL_MAPPING_SOURCE_MISMATCH",
]);
const knownPreparationBlockReasons = new Set([
  ...knownPreReservationFailure, "FISCAL_AUTOMATIC_SCOPE_DENIED", "FISCAL_SOURCE_UNAVAILABLE",
  "PROVENANCE_UNAVAILABLE", "FISCAL_TAX_COMBINATION_UNSUPPORTED",
  "UNSUPPORTED_EXPORT_TAX_COMBINATION", "UNSUPPORTED_PROVIDER_TAX_GROUP",
  "FISCAL_MAPPING_AMOUNT_MISMATCH", "FISCAL_PRICE_UNREPRESENTABLE",
  "FISCAL_GATE_DISABLED", "FISCAL_CONNECTION_CHANGED", "PLATFORM_FISCAL_CREDENTIAL_INVALID",
  "RESTAURANTS_STAFF_MEMBER_REQUIRED", "FISCAL_SCENARIO_UNSUPPORTED",
]);
function blockReason(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return knownPreparationBlockReasons.has(code) ? code : "FISCAL_PREPARATION_UNRESOLVED";
}

type Work = { orgId: string; outletId: string; sessionId: string;
  invoiceId: string; actorId: string; createdAt: string; fiscalBinding?: FiscalIssuanceBinding };

/** One committed intent. All provider commands remain owned by the fiscal service. */
export class RestaurantFiscalWorkProcessor {
  static async process(work: Work) {
    if (work.fiscalBinding) return this.processBound({ ...work, fiscalBinding: work.fiscalBinding });
    if (automaticFiscalPolicy() && !automaticFiscalEligible(work)) return { state: "NOT_CLAIMED" as const };
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
      if (automaticFiscalPolicy()) {
        await prepareAutomaticFiscalAuthorization(work, source.evidence.invoice.issuedAt);
      }
      await FiscalTestExecutionAuthorizationService.readBound({
        orgId: work.orgId, outletId: work.outletId, operatorUserId: work.actorId,
        sessionId: work.sessionId, invoiceId: work.invoiceId,
        sourceDigest: source.evidence.proof.digest,
      });
    } catch (error) {
      await RestaurantFiscalWorkRepository.block(work, claim, blockReason(error));
      return { state: "BLOCKED" as const };
    }
    const attemptId = `AUTO#${work.invoiceId}`;
    let phase: "INITIATE" | "RECONCILE" | "CONFIRM" = "INITIATE";
    try {
      const created = await realTestFiscalService.initiate(context, {
        ...request, attemptId, commandId: `${attemptId}#CREATE`,
      });
      if (created.status !== "CREATED") return { state: created.status };
      phase = "RECONCILE";
      await realTestFiscalService.recover(context, { ...request, providerOperation: "RECONCILE" });
      phase = "CONFIRM";
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
    } catch (error) {
      const code = error instanceof Error && knownPreReservationFailure.has(error.message)
        ? error.message : "FISCAL_EXECUTION_UNRESOLVED";
      // Only these mapping failures occur before reservation. Never infer safety
      // from an absent attempt after a timeout or conditional write failure.
      if (phase === "INITIATE" && code !== "FISCAL_EXECUTION_UNRESOLVED") {
        console.error(JSON.stringify({ event: "FISCAL_WORK_PRE_RESERVATION_BLOCKED",
          orgId: work.orgId, invoiceId: work.invoiceId, code }));
        await RestaurantFiscalWorkRepository.block(work, claim, code);
        return { state: "BLOCKED" as const };
      }
      console.error(JSON.stringify({ event: "FISCAL_WORK_UNRESOLVED",
        orgId: work.orgId, invoiceId: work.invoiceId, code }));
      // The fiscal attempt is authoritative. Never retry a provider mutation here.
      return { state: "UNRESOLVED" as const };
    }
  }
  private static async processBound(work: Work & { fiscalBinding: FiscalIssuanceBinding }) {
    if (work.fiscalBinding.environment !== "TEST" || !realFiscalTestEnabled()) return { state: "NOT_CLAIMED" as const };
    const claim = await RestaurantFiscalWorkRepository.claim(work);
    if (!claim) return { state: "NOT_CLAIMED" as const };
    let prepared: Awaited<ReturnType<typeof prepareBoundRestaurantWorkflow>>;
    try {
      prepared = await prepareBoundRestaurantWorkflow(work);
    } catch (error) {
      await RestaurantFiscalWorkRepository.block(work, claim, blockReason(error));
      return { state: "BLOCKED" as const };
    }
    const { workflow, principal, identity } = prepared;
    const attemptId = `AUTO#${work.invoiceId}`;
    try {
      const { state: created } = await workflow.create(principal, identity, attemptId, `${attemptId}#CREATE`);
      if (created.status !== "CREATED") return { state: created.status };
      await workflow.reconcile(principal, identity);
      const { state: confirmed } = await workflow.confirm(principal, identity, `${attemptId}#CONFIRM`, { confirm: true });
      if (confirmed.status === "CONFIRMED" && confirmed.security && confirmed.securityEvidenceOrigin === "DGI_TEST")
        await RestaurantFiscalWorkRepository.complete(work, claim);
      return { state: confirmed.status };
    } catch {
      console.error(JSON.stringify({ event: "FISCAL_WORK_UNRESOLVED", orgId: work.orgId, invoiceId: work.invoiceId }));
      return { state: "UNRESOLVED" as const };
    }
  }
}
