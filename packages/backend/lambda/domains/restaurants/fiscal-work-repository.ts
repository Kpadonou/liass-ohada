import { GetItemCommand, QueryCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { obligationIdentity } from "../fiscal-compliance/core/fiscal-attempt-state";
import { restaurantsTableName } from "./restaurant-storage";
import type { FiscalIssuanceBinding } from "@liass-ohada/shared/shared";
import { canonical } from "@/lambda/shared/authority/integrity";

const rowSchema = z.object({
  PK: z.string(), SK: z.string(), orgId: z.string(), outletId: z.string(),
  entityType: z.literal("RESTAURANT_FISCAL_WORK"), schemaVersion: z.literal(1),
  invoiceId: z.string().uuid(), sessionId: z.string().uuid(),
  createdAt: z.string().datetime(), state: z.enum(["PENDING", "CLAIMED", "BLOCKED", "CONFIRMED"]),
  claimToken: z.string().uuid().optional(), claimVersion: z.number().int().nonnegative().optional(),
  claimUntil: z.string().datetime().optional(),
  blockReason: z.string().regex(/^[A-Z][A-Z0-9_]{2,99}$/).optional(),
}).strict();

/** One tenant/outlet/day partition per bounded page. The caller advances days explicitly. */
export class RestaurantFiscalWorkRepository {
  /** Called only after the fiscal service returns persisted authentic confirmation.
   * This repairs a crash between fiscal confirmation and work completion. */
  static async settleConfirmed(input: { orgId: string; outletId: string; invoiceId: string;
    sessionId: string; createdAt: string }) {
    const keys = [
      { key: { PK: K.restaurantBillPK(input.orgId, input.outletId, input.invoiceId), SK: K.restaurantFiscalIntentSK() }, type: "RESTAURANT_FISCAL_INTENT" },
      { key: { PK: K.restaurantFiscalWorkPK(input.orgId, input.outletId, input.createdAt.slice(0, 10).replace(/-/g, "")),
        SK: K.restaurantFiscalWorkSK(input.createdAt, input.invoiceId) }, type: "RESTAURANT_FISCAL_WORK" },
    ];
    await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: keys.map(({ key, type }) => ({ Update: {
      TableName: restaurantsTableName(), Key: marshall(key),
      UpdateExpression: "SET #state = :confirmed",
      ConditionExpression: "entityType = :type AND orgId = :org AND outletId = :outlet AND invoiceId = :invoice AND sessionId = :session AND createdAt = :created",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: marshall({ ":confirmed": "CONFIRMED", ":type": type,
        ":org": input.orgId, ":outlet": input.outletId, ":invoice": input.invoiceId,
        ":session": input.sessionId, ":created": input.createdAt }),
    } })) }));
  }
  static async complete(input: { orgId: string; outletId: string; invoiceId: string;
    sessionId: string; createdAt: string }, claim: { token: string; version: number }) {
    const keys = [
      { key: { PK: K.restaurantBillPK(input.orgId, input.outletId, input.invoiceId), SK: K.restaurantFiscalIntentSK() }, type: "RESTAURANT_FISCAL_INTENT" },
      { key: { PK: K.restaurantFiscalWorkPK(input.orgId, input.outletId, input.createdAt.slice(0, 10).replace(/-/g, "")),
        SK: K.restaurantFiscalWorkSK(input.createdAt, input.invoiceId) }, type: "RESTAURANT_FISCAL_WORK" },
    ];
    await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: keys.map(({ key, type }) => ({ Update: {
      TableName: restaurantsTableName(), Key: marshall(key),
      UpdateExpression: "SET #state = :confirmed",
      ConditionExpression: "entityType = :type AND orgId = :org AND outletId = :outlet AND invoiceId = :invoice AND sessionId = :session AND createdAt = :created AND #state = :claimed AND claimToken = :token AND claimVersion = :version",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: marshall({ ":confirmed": "CONFIRMED", ":type": type,
        ":org": input.orgId, ":outlet": input.outletId, ":invoice": input.invoiceId,
        ":session": input.sessionId, ":created": input.createdAt,
        ":claimed": "CLAIMED", ":token": claim.token, ":version": claim.version }),
    } })) }));
  }
  /** Only the current claimant may mark a configuration or authorization block. */
  static async block(input: { orgId: string; outletId: string; invoiceId: string;
    sessionId: string; createdAt: string }, claim: { token: string; version: number }, reason = "FISCAL_PREPARATION_UNRESOLVED") {
    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(reason)) throw new Error("Invalid fiscal block reason");
    const key = { PK: K.restaurantBillPK(input.orgId, input.outletId, input.invoiceId),
      SK: K.restaurantFiscalIntentSK() };
    const locator = { PK: K.restaurantFiscalWorkPK(input.orgId, input.outletId,
      input.createdAt.slice(0, 10).replace(/-/g, "")),
      SK: K.restaurantFiscalWorkSK(input.createdAt, input.invoiceId) };
    const update = (target: typeof key, type: string) => ({ Update: {
      TableName: restaurantsTableName(), Key: marshall(target),
      UpdateExpression: "SET #state = :blocked, blockReason = :reason",
      ConditionExpression: "entityType = :type AND orgId = :org AND outletId = :outlet AND invoiceId = :invoice AND sessionId = :session AND createdAt = :created AND #state = :claimed AND claimToken = :token AND claimVersion = :version",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: marshall({ ":blocked": "BLOCKED", ":reason": reason, ":type": type,
        ":org": input.orgId, ":outlet": input.outletId, ":invoice": input.invoiceId,
        ":session": input.sessionId, ":created": input.createdAt,
        ":claimed": "CLAIMED", ":token": claim.token, ":version": claim.version }),
    } });
    await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
      update(key, "RESTAURANT_FISCAL_INTENT"), update(locator, "RESTAURANT_FISCAL_WORK"),
    ] }));
  }
  /** Claim is limited to work with no fiscal attempt. A claim timeout never
   * authorizes a second provider mutation; the attempt absence is checked in
   * the same transaction as both claim writes. */
  static async claim(input: { orgId: string; outletId: string; invoiceId: string;
    sessionId: string; createdAt: string; fiscalBinding?: FiscalIssuanceBinding }, now = new Date()) {
    const { orgId, outletId, invoiceId, sessionId, createdAt } = input;
    const intentKey = { PK: K.restaurantBillPK(orgId, outletId, invoiceId), SK: K.restaurantFiscalIntentSK() };
    const workKey = { PK: K.restaurantFiscalWorkPK(orgId, outletId, createdAt.slice(0, 10).replace(/-/g, "")),
      SK: K.restaurantFiscalWorkSK(createdAt, invoiceId) };
    const read = async (key: { PK: string; SK: string }) => {
      const result = await dynamoClient.send(new GetItemCommand({ TableName: restaurantsTableName(),
        Key: marshall(key), ConsistentRead: true }));
      return result.Item ? unmarshall(result.Item) : undefined;
    };
    const [work, intent] = await Promise.all([read(workKey), read(intentKey)]);
    const row = rowSchema.parse(work);
    if (row.orgId !== orgId || row.outletId !== outletId || row.invoiceId !== invoiceId ||
      row.sessionId !== sessionId || row.createdAt !== createdAt ||
      intent?.orgId !== orgId || intent?.outletId !== outletId ||
      intent?.invoiceId !== invoiceId || intent?.sessionId !== sessionId ||
      intent?.entityType !== "RESTAURANT_FISCAL_INTENT" || intent?.createdAt !== createdAt ||
      intent?.state !== row.state || intent?.claimVersion !== row.claimVersion ||
      intent?.claimToken !== row.claimToken || intent?.claimUntil !== row.claimUntil)
      throw new Error("Fiscal intent binding mismatch");
    if (input.fiscalBinding && (!intent.fiscalBinding || canonical(intent.fiscalBinding) !== canonical(input.fiscalBinding)))
      throw new Error("Fiscal intent policy mismatch");
    if (row.state === "CONFIRMED" ||
      (row.state === "CLAIMED" && (!row.claimUntil || Date.parse(row.claimUntil) > now.getTime())))
      return undefined;
    const token = randomUUID(), version = (row.claimVersion ?? 0) + 1;
    const until = new Date(now.getTime() + 60_000).toISOString();
    const attemptKey = { PK: K.orgKey(orgId), SK: K.fiscalAttemptEffectSK("TEST", obligationIdentity({
      orgId, environment: "TEST", sourceDomain: "restaurants", sourceDocumentType: "INVOICE",
      sourceDocumentId: invoiceId, jurisdiction: "BJ", obligation: "NORMALIZE",
    })) };
    const update = (key: { PK: string; SK: string }, type: string) => ({ Update: {
      TableName: restaurantsTableName(), Key: marshall(key),
      UpdateExpression: "SET #state = :claimed, claimToken = :token, claimVersion = :next, claimUntil = :until",
      ConditionExpression: "entityType = :type AND orgId = :org AND invoiceId = :invoice AND #state = :prior AND attribute_not_exists(claimVersion) AND attribute_not_exists(claimToken)",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: marshall({ ":claimed": "CLAIMED", ":token": token,
        ":next": version, ":until": until, ":type": type, ":org": orgId,
        ":invoice": invoiceId, ":prior": row.state }),
    } });
    // Existing claims require exact fencing, including expiry and prior token.
    const items = [update(workKey, "RESTAURANT_FISCAL_WORK"), update(intentKey, "RESTAURANT_FISCAL_INTENT")];
    if (input.fiscalBinding) {
      items[1].Update.ConditionExpression += " AND fiscalBinding = :binding";
      Object.assign(items[1].Update.ExpressionAttributeValues, marshall({ ":binding": input.fiscalBinding }));
    }
    if (row.claimVersion !== undefined) for (const item of items) {
      const op = item.Update;
      op.ConditionExpression = op.ConditionExpression.replace(
        "attribute_not_exists(claimVersion) AND attribute_not_exists(claimToken)",
        "claimVersion = :priorVersion AND claimToken = :priorToken AND claimUntil = :priorUntil",
      );
      Object.assign(op.ExpressionAttributeValues, marshall({ ":priorVersion": row.claimVersion,
        ":priorToken": row.claimToken, ":priorUntil": row.claimUntil }));
    }
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
        ...items,
        { ConditionCheck: { TableName: config.TABLE_NAME, Key: marshall(attemptKey),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      ] }));
    } catch (error) {
      if (error instanceof Error && ["TransactionCanceledException", "TransactionConflictException"].includes(error.name))
        return undefined;
      throw error;
    }
    return { token, version, until };
  }
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
    }).filter((row) => row.state !== "CONFIRMED");
    const next = page.LastEvaluatedKey && unmarshall(page.LastEvaluatedKey);
    return { items, nextCursor: next ? Buffer.from(JSON.stringify({ PK: next.PK, SK: next.SK })).toString("base64url") : undefined };
  }
}
