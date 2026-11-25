import { selectBeninSfeScenario } from "../fiscal-compliance/providers/benin-emecef/sfe-scenarios";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { z } from "zod";
import { CognitoSubjectSchema } from "@/lambda/shared/authorization/platform-admin";
import { randomUUID } from "node:crypto";
import { FiscalTestExecutionAuthorizationService } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { RestaurantFiscalAuthorizationPreparationService } from "./fiscal-authorization-preparation-service";
const schema = z.object({ orgId: z.string().min(1), outletId: z.string().uuid(),
  connectionId: z.string().uuid(), delegatedBy: CognitoSubjectSchema, activatedAt: z.string().datetime() }).strict();
export function automaticFiscalPolicy() {
  if (process.env.STAGE !== "dev" || !process.env.FISCAL_AUTOMATIC_POLICY) return undefined;
  return schema.parse(JSON.parse(process.env.FISCAL_AUTOMATIC_POLICY));
}
export function automaticFiscalEligible(work: {orgId: string; outletId: string; createdAt: string}) {
  const policy = automaticFiscalPolicy();
  return !!policy && policy.orgId === work.orgId && policy.outletId === work.outletId &&
    Date.parse(work.createdAt) > Date.parse(policy.activatedAt);
}
/** Called only after the existing atomic claim proves there is no fiscal attempt. */
export async function prepareAutomaticFiscalAuthorization(work: {orgId: string; outletId: string;
  sessionId: string; invoiceId: string; actorId: string; createdAt: string}, issuedAt: string) {
  const policy = automaticFiscalPolicy();
  if (!policy || !automaticFiscalEligible(work) || issuedAt !== work.createdAt)
    throw new Error("FISCAL_AUTOMATIC_SCOPE_DENIED");
  const prepared = await prepareRestaurantFiscalInvoice({scope: {orgId: work.orgId, outletId: work.outletId},
    actorId: work.actorId, sessionId: work.sessionId, invoiceId: work.invoiceId, classifications: [], requireV1: true});
  if (!prepared.ready) throw new Error("FISCAL_PREPARATION_UNAVAILABLE");
  const scenarioId = selectBeninSfeScenario({
    // C is an explicit frozen export classification. TPS E alone remains
    // domestic: EV/E needs an independently supplied export intent.
    type: prepared.preparation.lines.some(line => line.fiscal.taxGroup === "C") ? "EV" : "FV",
    items: prepared.preparation.lines.map(line => ({
      taxGroup: line.fiscal.taxGroup, quantity: line.commercial.snapshot.quantity,
      taxSpecific: line.fiscal.taxSpecificMinor,
    })),
    customer: prepared.preparation.customer, aib: prepared.preparation.aib,
  });
  if (!scenarioId) throw new Error("FISCAL_SCENARIO_UNSUPPORTED");
  const proof = await RestaurantFiscalAuthorizationPreparationService.prepare({
    ...work, scenarioId, commandId: randomUUID(), automaticPolicy: true,
  });
  await FiscalTestExecutionAuthorizationService.approveAutomaticProof(policy, {
    proofId: proof.proofId, proofDigest: proof.proofDigest, connectionId: policy.connectionId,
    commandId: randomUUID(),
  }, issuedAt);
}
