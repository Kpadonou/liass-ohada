import { processCreditFiscalIntent } from "./credit-fiscal-work";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { FiscalIssuanceBindingSchema } from "@liass-ohada/shared/shared";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { restaurantsTableName } from "./restaurant-storage";
import { RestaurantFiscalWorkProcessor } from "./fiscal-work-processor";

const intent = z.object({
  PK: z.string(), SK: z.literal("FISCAL_INTENT#V1"),
  orgId: z.string().min(1), outletId: z.string().uuid(),
  invoiceId: z.string().uuid(), sessionId: z.string().uuid(),
  actorId: z.string().min(1), createdAt: z.string().datetime(),
  entityType: z.literal("RESTAURANT_FISCAL_INTENT"), schemaVersion: z.literal(1),
  state: z.enum(["PENDING", "BLOCKED", "CLAIMED", "CONFIRMED"]),
}).passthrough();

/** KEYS_ONLY stream reader. A failed record is returned to Lambda for retry. */
export async function processFiscalIntentStream(event: DynamoDBStreamEvent) {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    if (record.eventName !== "INSERT" ||
      record.dynamodb?.Keys?.SK?.S !== K.restaurantFiscalIntentSK()) continue;
    try {
      const key = record.dynamodb.Keys;
      const PK = key.PK?.S;
      if (!PK || !record.dynamodb.SequenceNumber) throw new Error("Invalid fiscal stream key");
      const response = await dynamoClient.send(new GetItemCommand({
        TableName: restaurantsTableName(), Key: marshall({ PK, SK: K.restaurantFiscalIntentSK() }),
        ConsistentRead: true,
      }));
      if (!response.Item) throw new Error("Missing committed fiscal intent");
      const committed = unmarshall(response.Item);
      if (committed.entityType === "RESTAURANT_CREDIT_FISCAL_INTENT") {
        if (committed.PK !== PK) throw new Error("Fiscal credit scope mismatch");
        await processCreditFiscalIntent(committed);
        continue;
      }
      const row = intent.parse(committed);
      if (row.PK !== PK || row.PK !== K.restaurantBillPK(row.orgId, row.outletId, row.invoiceId))
        throw new Error("Fiscal intent scope mismatch");
      if (!Object.hasOwn(row, "fiscalBinding")) continue;
      await RestaurantFiscalWorkProcessor.process({
        orgId: row.orgId, outletId: row.outletId, invoiceId: row.invoiceId,
        sessionId: row.sessionId, actorId: row.actorId, createdAt: row.createdAt,
        fiscalBinding: FiscalIssuanceBindingSchema.parse(row.fiscalBinding),
      });
    } catch {
      if (record.dynamodb?.SequenceNumber)
        batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
      else throw new Error("Fiscal stream record without sequence number");
    }
  }
  return { batchItemFailures };
}
