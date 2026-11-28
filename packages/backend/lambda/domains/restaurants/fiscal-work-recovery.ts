import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { restaurantsTableName } from "./restaurant-storage";
import { RestaurantFiscalWorkProcessor } from "./fiscal-work-processor";
import { realTestFiscalService } from "./real-test-fiscal-handler";
import { RestaurantFiscalWorkRepository } from "./fiscal-work-repository";
import { FiscalIssuanceBindingSchema } from "@liass-ohada/shared/shared";
import { canonical, hash } from "@/lambda/shared/authority/integrity";
import { prepareBoundRestaurantWorkflow } from "./bound-fiscal-workflow";

export const fiscalWorkRecoveryRequest = z.object({
  type: z.literal("RECOVER_FISCAL_WORK_V1"),
  orgId: z.string().min(1),
  outletId: z.string().uuid(),
  sessionId: z.string().uuid(),
  invoiceId: z.string().uuid(),
}).strict();
export const boundFiscalWorkRecoveryRequest = fiscalWorkRecoveryRequest.extend({
  type: z.literal("RECOVER_BOUND_FISCAL_WORK_V1"),
  expectedClaimVersion: z.number().int().nonnegative(),
  expectedBindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

const blockedIntent = z.object({
  PK: z.string(), SK: z.literal("FISCAL_INTENT#V1"),
  entityType: z.literal("RESTAURANT_FISCAL_INTENT"), schemaVersion: z.literal(1),
  orgId: z.string(), outletId: z.string().uuid(), sessionId: z.string().uuid(),
  invoiceId: z.string().uuid(), actorId: z.string().min(1),
  createdAt: z.string().datetime(), state: z.literal("BLOCKED"),
}).passthrough();

/** IAM-protected direct Lambda invocation for one existing BLOCKED intent. */
export async function recoverBlockedFiscalWork(input: unknown) {
  const request = fiscalWorkRecoveryRequest.parse(input);
  const PK = K.restaurantBillPK(request.orgId, request.outletId, request.invoiceId);
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: restaurantsTableName(),
    Key: marshall({ PK, SK: K.restaurantFiscalIntentSK() }),
    ConsistentRead: true,
  }));
  if (!result.Item) throw new Error("Blocked fiscal intent not found");
  const row = blockedIntent.parse(unmarshall(result.Item));
  if (Object.hasOwn(row, "fiscalBinding")) throw new Error("Bound fiscal intent requires the shared processor");
  if (row.PK !== PK || row.SK !== K.restaurantFiscalIntentSK() ||
    row.orgId !== request.orgId || row.outletId !== request.outletId ||
    row.sessionId !== request.sessionId || row.invoiceId !== request.invoiceId)
    throw new Error("Blocked fiscal intent identity mismatch");
  return RestaurantFiscalWorkProcessor.process({
    orgId: row.orgId, outletId: row.outletId, sessionId: row.sessionId,
    invoiceId: row.invoiceId, actorId: row.actorId, createdAt: row.createdAt,
  });
}

/** Separate IAM-only recovery for an immutable TEST binding. No replay occurs on deployment. */
export async function recoverBoundFiscalWork(input: unknown) {
  const request = boundFiscalWorkRecoveryRequest.parse(input);
  const PK = K.restaurantBillPK(request.orgId, request.outletId, request.invoiceId);
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: restaurantsTableName(), Key: marshall({ PK, SK: K.restaurantFiscalIntentSK() }),
    ConsistentRead: true,
  }));
  if (!result.Item) throw new Error("Blocked fiscal intent not found");
  const row = blockedIntent.extend({ claimVersion: z.number().int().nonnegative(),
    fiscalBinding: FiscalIssuanceBindingSchema }).parse(unmarshall(result.Item));
  if (row.PK !== PK || row.orgId !== request.orgId || row.outletId !== request.outletId ||
    row.sessionId !== request.sessionId || row.invoiceId !== request.invoiceId ||
    row.claimVersion !== request.expectedClaimVersion ||
    hash(canonical(row.fiscalBinding)) !== request.expectedBindingDigest ||
    row.fiscalBinding.environment !== "TEST")
    throw new Error("Bound fiscal recovery identity mismatch");
  const work = { orgId: row.orgId, outletId: row.outletId, sessionId: row.sessionId,
    invoiceId: row.invoiceId, actorId: row.actorId, createdAt: row.createdAt,
    fiscalBinding: row.fiscalBinding };
  // Provider-free source, mapping, reconciliation expectation and credential preflight.
  await prepareBoundRestaurantWorkflow(work);
  // The processor's transaction fences the claim against an existing attempt.
  return RestaurantFiscalWorkProcessor.process(work);
}

/** IAM-only, provider-free settlement. Never enters the execution processor. */
export async function completeConfirmedFiscalWork(input: unknown) {
  const request = fiscalWorkRecoveryRequest.extend({ type: z.literal("COMPLETE_CONFIRMED_FISCAL_WORK_V1") }).parse(input);
  const PK = K.restaurantBillPK(request.orgId, request.outletId, request.invoiceId);
  const response = await dynamoClient.send(new GetItemCommand({ TableName: restaurantsTableName(),
    Key: marshall({ PK, SK: K.restaurantFiscalIntentSK() }), ConsistentRead: true }));
  if (!response.Item) throw new Error("Fiscal intent not found");
  const row = blockedIntent.extend({ state: z.enum(["CLAIMED", "CONFIRMED"]) }).parse(unmarshall(response.Item));
  if (row.PK !== PK || row.orgId !== request.orgId || row.outletId !== request.outletId ||
    row.sessionId !== request.sessionId || row.invoiceId !== request.invoiceId) throw new Error("Fiscal intent identity mismatch");
  const result = await realTestFiscalService.confirmedResult({ orgId: row.orgId, userId: row.actorId },
    { outletId: row.outletId, sessionId: row.sessionId, invoiceId: row.invoiceId });
  if (!result.confirmed || !result.securityElements || result.evidenceOrigin !== "DGI_TEST")
    throw new Error("Persisted DGI confirmation required");
  await RestaurantFiscalWorkRepository.settleConfirmed(row);
  console.info(JSON.stringify({ event: "FISCAL_WORK_LOCAL_COMPLETION", orgId: row.orgId, invoiceId: row.invoiceId }));
  return { ...result, workState: "CONFIRMED" as const };
}
