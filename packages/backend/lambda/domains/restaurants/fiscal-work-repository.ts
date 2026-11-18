import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { restaurantsTableName } from "./restaurant-storage";

const rowSchema = z.object({
  PK: z.string(), SK: z.string(), orgId: z.string(), outletId: z.string(),
  entityType: z.literal("RESTAURANT_FISCAL_WORK"), schemaVersion: z.literal(1),
  invoiceId: z.string().uuid(), sessionId: z.string().uuid(),
  createdAt: z.string().datetime(), state: z.literal("PENDING"),
}).strict();

/** One tenant/outlet/day partition per bounded page. The caller advances days explicitly. */
export class RestaurantFiscalWorkRepository {
  static async pending(orgId: string, outletId: string, day: string, cursor?: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid fiscal work limit");
    const PK = K.restaurantFiscalWorkPK(orgId, outletId, day);
    let start: { PK: string; SK: string } | undefined;
    if (cursor) {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      start = z.object({ PK: z.literal(PK), SK: z.string().startsWith("PENDING#") }).strict().parse(value);
    }
    const page = await dynamoClient.send(new QueryCommand({
      TableName: restaurantsTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: marshall({ ":pk": PK, ":prefix": "PENDING#" }),
      ConsistentRead: true, Limit: limit,
      ...(start ? { ExclusiveStartKey: marshall(start) } : {}),
    }));
    const items = (page.Items ?? []).map((raw) => {
      const row = rowSchema.parse(unmarshall(raw));
      if (row.PK !== PK || row.SK !== K.restaurantFiscalWorkSK(row.createdAt, row.invoiceId) ||
        row.orgId !== orgId || row.outletId !== outletId) throw new Error("Fiscal work scope mismatch");
      return row;
    });
    const next = page.LastEvaluatedKey && unmarshall(page.LastEvaluatedKey);
    return { items, nextCursor: next ? Buffer.from(JSON.stringify({ PK: next.PK, SK: next.SK })).toString("base64url") : undefined };
  }
}
