import { z } from "zod";
import { randomUUID } from "node:crypto";
import { FiscalTestExecutionAuthorizationService } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { RestaurantFiscalAuthorizationPreparationService } from "./fiscal-authorization-preparation-service";
const schema = z.object({ orgId: z.string().min(1), outletId: z.string().uuid(),
  connectionId: z.string().uuid(), delegatedBy: z.string().uuid(), activatedAt: z.string().datetime() }).strict();
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
  const proof = await RestaurantFiscalAuthorizationPreparationService.prepare({
    ...work, scenarioId: "02", commandId: randomUUID(), automaticPolicy: true,
  });
  await FiscalTestExecutionAuthorizationService.approveAutomaticProof(policy, {
    proofId: proof.proofId, proofDigest: proof.proofDigest, connectionId: policy.connectionId,
    commandId: randomUUID(),
  }, issuedAt);
}
