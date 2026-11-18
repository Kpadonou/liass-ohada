import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { restaurantsTableName } from "./restaurant-storage";
import { RestaurantFiscalWorkProcessor } from "./fiscal-work-processor";

export const fiscalWorkRecoveryRequest = z.object({
  type: z.literal("RECOVER_FISCAL_WORK_V1"),
  orgId: z.string().min(1),
  outletId: z.string().uuid(),
  sessionId: z.string().uuid(),
  invoiceId: z.string().uuid(),
}).strict();

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
  if (row.PK !== PK || row.SK !== K.restaurantFiscalIntentSK() ||
    row.orgId !== request.orgId || row.outletId !== request.outletId ||
    row.sessionId !== request.sessionId || row.invoiceId !== request.invoiceId)
    throw new Error("Blocked fiscal intent identity mismatch");
  return RestaurantFiscalWorkProcessor.process({
    orgId: row.orgId, outletId: row.outletId, sessionId: row.sessionId,
    invoiceId: row.invoiceId, actorId: row.actorId, createdAt: row.createdAt,
  });
}
