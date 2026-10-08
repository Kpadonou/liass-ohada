import { GetItemCommand, QueryCommand, TransactWriteItemsCommand, AttributeValue } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { BeninFiscalProfileSchema, FiscalEnvironment, FiscalSourceRequest } from "@liass-ohada/shared/fiscal-compliance";
import { config, dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { FiscalCertificationInternalSchema, FiscalConnectionInternalSchema, FiscalCertificationInternal } from "./fiscal-persistence-model";

const metadata = { PK: z.string(), SK: z.string(), orgId: z.string(), entityType: z.string() };
const commandSchema = z.object({ ...metadata, entityType: z.literal("FISCAL_COMMAND"), intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  environment: z.enum(["TEST", "PRODUCTION"]), sourceDocumentType: z.enum(["INVOICE", "CREDIT_NOTE"]),
  sourceDocumentId: z.string(), version: z.number().int().positive() }).strict();
const historySchema = z.object({ ...metadata, entityType: z.literal("FISCAL_HISTORY"), actorUserId: z.string(),
  action: z.enum(["FISCAL_CERTIFICATION_PREPARED", "FISCAL_PREPARATION_UPDATED"]), data: FiscalCertificationInternalSchema }).strict();
export class FiscalWriteConflict extends Error {}
const record = <T>(orgId: string, sk: string, type: string, data: T) => ({ PK: KeyFactory.orgKey(orgId), SK: sk, orgId, entityType: type, data });

/** Conservative UTF-8 upper bound including DynamoDB attribute names and representation overhead. */
export function boundedFiscalItem(item: Record<string, unknown>): Record<string, AttributeValue> {
  const marshalled = marshall(item, { removeUndefinedValues: true });
  if (Buffer.byteLength(JSON.stringify(marshalled), "utf8") > 350 * 1024) throw new AppError(422, "FISCAL_SNAPSHOT_TOO_LARGE");
  return marshalled;
}
export class FiscalRepository {
  private static async get<T>(orgId: string, sk: string, entityType: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const response = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: KeyFactory.orgKey(orgId), SK: sk }), ConsistentRead: true }));
    if (!response.Item) return undefined;
    const item = z.object({ ...metadata, data: schema }).strict().parse(unmarshall(response.Item));
    if (item.PK !== KeyFactory.orgKey(orgId) || item.SK !== sk || item.orgId !== orgId || item.entityType !== entityType) {
      throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
    }
    return item.data;
  }
  static getProfile(orgId: string) { return this.get(orgId, KeyFactory.fiscalProfileSK(), "FISCAL_PROFILE", BeninFiscalProfileSchema); }
  static async getConnection(orgId: string, environment: FiscalEnvironment, id: string) {
    const data = await this.get(orgId, KeyFactory.fiscalConnectionSK(environment, id), "FISCAL_CONNECTION", FiscalConnectionInternalSchema);
    if (data && (data.connectionId !== id || data.environment !== environment)) throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
    return data;
  }
  static async getCertification(orgId: string, source: FiscalSourceRequest) {
    const data = await this.get(orgId, KeyFactory.fiscalCertificationSK(source.environment, source.sourceDocumentType, source.sourceDocumentId),
      "FISCAL_CERTIFICATION", FiscalCertificationInternalSchema);
    if (data && (data.environment !== source.environment || data.sourceDocumentType !== source.sourceDocumentType ||
      data.sourceDocumentId !== source.sourceDocumentId || data.preparationSnapshot.source.orgId !== orgId)) throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
    return data;
  }
  static async listConnections(orgId: string, environment: FiscalEnvironment, limit: number, cursor?: string) {
    const prefix = KeyFactory.fiscalConnectionPrefix(environment);
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;
    if (cursor) {
      try {
        const key = z.object({ PK: z.literal(KeyFactory.orgKey(orgId)), SK: z.string().startsWith(prefix) }).strict()
          .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
        exclusiveStartKey = marshall(key);
      } catch { throw new AppError(400, "ERROR_INVALID_CURSOR"); }
    }
    const result = await dynamoClient.send(new QueryCommand({ TableName: config.TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: marshall({ ":pk": KeyFactory.orgKey(orgId), ":prefix": prefix }),
      ConsistentRead: true, Limit: limit, ExclusiveStartKey: exclusiveStartKey }));
    const items = (result.Items ?? []).map(raw => {
      const item = z.object({ ...metadata, data: FiscalConnectionInternalSchema }).strict().parse(unmarshall(raw));
      if (item.orgId !== orgId || item.PK !== KeyFactory.orgKey(orgId) || item.entityType !== "FISCAL_CONNECTION" ||
        item.data.environment !== environment || item.SK !== KeyFactory.fiscalConnectionSK(environment, item.data.connectionId)) {
        throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
      }
      return item.data;
    });
    return { items, nextCursor: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(unmarshall(result.LastEvaluatedKey))).toString("base64url") : undefined };
  }
  static async saveConfiguration(orgId: string, sk: string, entityType: "FISCAL_PROFILE" | "FISCAL_CONNECTION",
    data: Record<string, unknown>, expectedVersion: number, actorUserId: string) {
    const version = data.version as number;
    const item = record(orgId, sk, entityType, data);
    await this.transact([
      { Put: { TableName: config.TABLE_NAME, Item: boundedFiscalItem(item),
        ...this.versionCondition(entityType, expectedVersion) } },
      { Put: { TableName: config.TABLE_NAME, Item: boundedFiscalItem({
        PK: KeyFactory.orgKey(orgId), SK: KeyFactory.fiscalConfigurationHistorySK(sk, version), orgId,
        entityType: "FISCAL_CONFIGURATION_HISTORY", action: `${entityType}_${expectedVersion === 0 ? "CREATED" : "UPDATED"}`,
        version, actorUserId, changedAt: data.updatedAt,
      }), ConditionExpression: "attribute_not_exists(PK)" } },
    ]);
  }
  static async getCommand(orgId: string, commandId: string) {
    const sk = KeyFactory.fiscalCommandSK(commandId);
    const result = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: KeyFactory.orgKey(orgId), SK: sk }), ConsistentRead: true }));
    if (!result.Item) return undefined;
    const command = commandSchema.parse(unmarshall(result.Item));
    if (command.orgId !== orgId || command.PK !== KeyFactory.orgKey(orgId) || command.SK !== sk) throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
    return command;
  }
  static async getRevision(orgId: string, source: FiscalSourceRequest, version: number) {
    const sk = KeyFactory.fiscalHistorySK(source.environment, source.sourceDocumentType, source.sourceDocumentId, version);
    const result = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: KeyFactory.orgKey(orgId), SK: sk }), ConsistentRead: true }));
    if (!result.Item) throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
    const item = historySchema.parse(unmarshall(result.Item));
    if (item.orgId !== orgId || item.PK !== KeyFactory.orgKey(orgId) || item.SK !== sk ||
      item.data.environment !== source.environment || item.data.sourceDocumentType !== source.sourceDocumentType ||
      item.data.sourceDocumentId !== source.sourceDocumentId || item.data.preparationSnapshot.source.orgId !== orgId) throw new AppError(404, "FISCAL_RECORD_NOT_FOUND");
    return item.data;
  }
  static async savePreparation(orgId: string, data: FiscalCertificationInternal, expectedVersion: number,
    commandId: string, intentHash: string, actorUserId: string) {
    const sk = KeyFactory.fiscalCertificationSK(data.environment, data.sourceDocumentType, data.sourceDocumentId);
    const condition = this.versionCondition("FISCAL_CERTIFICATION", expectedVersion);
    if (expectedVersion > 0) {
      condition.ConditionExpression += " AND (#data.#status = :prepared OR #data.#status = :unprepared)";
      condition.ExpressionAttributeNames = { ...condition.ExpressionAttributeNames, "#status": "status" };
      condition.ExpressionAttributeValues = { ...condition.ExpressionAttributeValues, ...marshall({ ":prepared": "PREPARED", ":unprepared": "UNPREPARED" }) };
    }
    await this.transact([
      { Put: { TableName: config.TABLE_NAME, Item: boundedFiscalItem(record(orgId, sk, "FISCAL_CERTIFICATION", data)), ...condition } },
      { Put: { TableName: config.TABLE_NAME, Item: boundedFiscalItem({ ...record(orgId,
        KeyFactory.fiscalHistorySK(data.environment, data.sourceDocumentType, data.sourceDocumentId, data.version), "FISCAL_HISTORY", data),
        actorUserId, action: expectedVersion === 0 ? "FISCAL_CERTIFICATION_PREPARED" : "FISCAL_PREPARATION_UPDATED" }),
        ConditionExpression: "attribute_not_exists(PK)" } },
      { Put: { TableName: config.TABLE_NAME, Item: boundedFiscalItem(commandSchema.parse({
        PK: KeyFactory.orgKey(orgId), SK: KeyFactory.fiscalCommandSK(commandId), orgId, entityType: "FISCAL_COMMAND", intentHash,
        environment: data.environment, sourceDocumentType: data.sourceDocumentType, sourceDocumentId: data.sourceDocumentId, version: data.version,
      })), ConditionExpression: "attribute_not_exists(PK)" } },
    ]);
  }
  private static versionCondition(entityType: string, expectedVersion: number) {
    return expectedVersion === 0 ? { ConditionExpression: "attribute_not_exists(PK)",
      ExpressionAttributeNames: undefined as Record<string, string> | undefined,
      ExpressionAttributeValues: undefined as Record<string, AttributeValue> | undefined } : {
      ConditionExpression: "#entityType = :type AND #data.#version = :version",
      ExpressionAttributeNames: { "#entityType": "entityType", "#data": "data", "#version": "version" },
      ExpressionAttributeValues: marshall({ ":type": entityType, ":version": expectedVersion }),
    };
  }
  private static async transact(TransactItems: NonNullable<ConstructorParameters<typeof TransactWriteItemsCommand>[0]["TransactItems"]>) {
    try { await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems })); }
    catch (error) {
      const failure = error as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (failure.name === "TransactionCanceledException" && failure.CancellationReasons?.some(r => r.Code === "ConditionalCheckFailed")) throw new FiscalWriteConflict();
      throw error;
    }
  }
}
