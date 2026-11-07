import { createHash } from "node:crypto";
import { GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { SfeApprovalSchema, PutSfeApprovalRequestSchema } from "@liass-ohada/shared/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { AppError } from "../app-error";
import { PlatformGrantSchema, PlatformPrincipal, platformPrincipalDigest } from "../authorization/platform-admin";

const table = () => config.PLATFORM_TABLE_NAME;
const putRequest = PutSfeApprovalRequestSchema;
const approvalRecord = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal("PLATFORM_SFE_APPROVAL"),
  data: SfeApprovalSchema,
}).strict();
const grantRecord = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal("PLATFORM_ADMIN_GRANT"),
  data: PlatformGrantSchema,
}).strict();
const commandRecord = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal("PLATFORM_SFE_COMMAND"),
  principalDigest: z.string(), intentDigest: z.string(), result: SfeApprovalSchema,
}).strict();
const deny = () => new AppError(403, "PLATFORM_ADMIN_REQUIRED");
export class PlatformSfeRepository {
  private static async get(PK: string, SK: string) {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: table(), Key: marshall({ PK, SK }), ConsistentRead: true,
    }));
    return result.Item ? unmarshall(result.Item) : undefined;
  }
  static async requireGrant(principal: PlatformPrincipal) {
    try {
      const PK = K.platformAdminPK(principal.stage, platformPrincipalDigest(principal));
      const SK = K.platformAdminGrantSK();
      const row = grantRecord.parse(await this.get(PK, SK));
      if (row.PK !== PK || row.SK !== SK || row.data.stage !== principal.stage ||
        row.data.issuer !== principal.issuer || row.data.sub !== principal.sub ||
        row.data.status !== "ACTIVE" || row.data.revokedAt !== null) throw deny();
      return row;
    } catch { throw deny(); }
  }
  static async read(stage: PlatformPrincipal["stage"]) {
    const PK = K.platformSfePK(stage), SK = K.platformSfeCurrentSK();
    const raw = await this.get(PK, SK);
    if (!raw) return { status: "UNAVAILABLE" as const, approval: null };
    const row = approvalRecord.parse(raw);
    if (row.PK !== PK || row.SK !== SK) throw new AppError(503, "PLATFORM_SFE_UNAVAILABLE");
    return { status: "REGISTERED" as const, approval: row.data };
  }
  static async update(principal: PlatformPrincipal, input: unknown) {
    const grant = await this.requireGrant(principal);
    const request = putRequest.parse(input);
    const { expectedVersion, commandId, ...fields } = request;
    const PK = K.platformSfePK(principal.stage);
    const principalDigest = platformPrincipalDigest(principal);
    // Schema-normalized field order makes intent stable across JSON property order.
    const intentDigest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const commandKey = { PK, SK: K.platformSfeCommandSK(commandId) };
    const replay = async () => {
      const raw = await this.get(commandKey.PK, commandKey.SK);
      if (!raw) return undefined;
      const record = commandRecord.parse(raw);
      if (record.PK !== PK || record.SK !== commandKey.SK || record.principalDigest !== principalDigest || record.intentDigest !== intentDigest)
        throw new AppError(409, "PLATFORM_SFE_COMMAND_CONFLICT");
      return record.result;
    };
    const previous = await replay();
    if (previous) return previous;
    const data = SfeApprovalSchema.parse({ ...fields, version: expectedVersion + 1, updatedAt: new Date().toISOString() });
    const current = { PK, SK: K.platformSfeCurrentSK(), entityType: "PLATFORM_SFE_APPROVAL", data };
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({
        TransactItems: [
          { ConditionCheck: { TableName: table(), Key: marshall({ PK: grant.PK, SK: grant.SK }),
            ConditionExpression: "#data = :grant AND entityType = :grantType", ExpressionAttributeNames: { "#data": "data" },
            ExpressionAttributeValues: marshall({ ":grant": grant.data, ":grantType": "PLATFORM_ADMIN_GRANT" }) } },
          { Put: { TableName: table(), Item: marshall(current),
            ConditionExpression: expectedVersion === 0 ? "attribute_not_exists(PK)" : "#data.#version = :version AND entityType = :type",
            ...(expectedVersion === 0 ? {} : {
              ExpressionAttributeNames: { "#data": "data", "#version": "version" },
              ExpressionAttributeValues: marshall({ ":version": expectedVersion, ":type": "PLATFORM_SFE_APPROVAL" }),
            }) } },
          { Put: { TableName: table(), Item: marshall({ ...current,
            SK: K.platformSfeRevisionSK(data.version), entityType: "PLATFORM_SFE_APPROVAL_REVISION",
            principalDigest, issuer: principal.issuer, sub: principal.sub, grantVersion: grant.data.version, commandId,
          }), ConditionExpression: "attribute_not_exists(PK)" } },
          { Put: { TableName: table(), Item: marshall({ ...commandKey, entityType: "PLATFORM_SFE_COMMAND", principalDigest, intentDigest, result: data }),
            ConditionExpression: "attribute_not_exists(PK)" } },
        ],
      }));
    } catch (error) {
      // A timeout can mean committed. Resolve the same durable command; never generate a new intent.
      await this.requireGrant(principal);
      const committed = await replay();
      if (committed) return committed;
      const cancelled = error as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (cancelled.name === "TransactionCanceledException" && cancelled.CancellationReasons?.some(reason => reason.Code === "ConditionalCheckFailed"))
        throw new AppError(409, "PLATFORM_SFE_VERSION_CONFLICT");
      throw new AppError(503, "PLATFORM_SFE_UNAVAILABLE");
    }
    return data;
  }
}
