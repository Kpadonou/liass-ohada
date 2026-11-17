import { createHash, randomUUID } from "node:crypto";
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { canonical } from "../authority/integrity";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { CognitoSubjectSchema } from "../authorization/platform-admin";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const operation = z.enum(["CREATE", "GET", "CONFIRM", "CANCEL"]);
const boundedJson = z.unknown().refine((value) => {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" && Buffer.byteLength(encoded) <= 32 * 1024;
  } catch {
    return false;
  }
});
export const FiscalExpectedTotalsSchema = z.object({
  ta: z.number().int().nonnegative(), tb: z.number().int().nonnegative(),
  tc: z.number().int().nonnegative(), td: z.number().int().nonnegative(),
  taa: z.number().int().nonnegative(), tab: z.number().int().nonnegative(),
  tac: z.number().int().nonnegative(), tad: z.number().int().nonnegative(),
  tae: z.number().int().nonnegative(), taf: z.number().int().nonnegative(),
  hab: z.number().int().nonnegative(), had: z.number().int().nonnegative(),
  vab: z.number().int().nonnegative(), vad: z.number().int().nonnegative(),
  aib: z.number().int().nonnegative(), ts: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict();

const proofInputBaseSchema = z.object({
  orgId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  outletId: uuid,
  operatorUserId: CognitoSubjectSchema,
  sessionId: uuid,
  invoiceId: uuid,
  sourceDigest: digest,
  sourceVersion: z.number().int().nonnegative(),
  financialRevision: z.number().int().nonnegative(),
  sellerAuthorityDigest: digest,
  scenarioId: z.string().regex(/^([0-9]{2})$/),
  fiscalGroups: z.array(z.enum(["A", "B", "C", "D", "E"])).min(1).max(5),
  fiscalMapping: boundedJson,
  expectedFiscalTotals: FiscalExpectedTotalsSchema,
  operations: z.record(operation, z.number().int().positive().max(10))
    .refine((value) => Object.keys(value).length > 0),
  expiresAt: z.string().datetime(),
  commandId: uuid,
}).strict();
export const FiscalSourcePreparationProofInputSchema = proofInputBaseSchema.superRefine((value, context) => {
  const lifetime = Date.parse(value.expiresAt) - Date.now();
  if (lifetime <= 0 || lifetime > 30 * 60 * 1000)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "expiry must be within 30 minutes" });
});
export type FiscalSourcePreparationProofInput = z.infer<typeof FiscalSourcePreparationProofInputSchema>;

const proofDataSchema = proofInputBaseSchema.omit({ commandId: true }).extend({
  proofId: uuid,
  proofDigest: digest,
  preparedAt: z.string().datetime(),
  status: z.enum(["PREPARED", "CONSUMED"]),
  consumedAt: z.string().datetime().optional(),
  consumedBy: CognitoSubjectSchema.optional(),
}).strict();
export type FiscalSourcePreparationProof = z.infer<typeof proofDataSchema>;

const proofRecordSchema = z.object({
  PK: z.string(), SK: z.string(), orgId: z.string(),
  entityType: z.literal("PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF"),
  expiresAtEpochSeconds: z.number().int().positive(),
  data: proofDataSchema,
}).strict();
const commandDataSchema = z.object({
  commandId: uuid, requestDigest: digest, proofId: uuid, proofDigest: digest,
}).strict();
const commandRecordSchema = z.object({
  PK: z.string(), SK: z.string(), orgId: z.string(),
  entityType: z.literal("PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF_COMMAND"),
  expiresAtEpochSeconds: z.number().int().positive(), data: commandDataSchema,
}).strict();

const table = () => config.PLATFORM_TABLE_NAME;
const requestDigest = (value: FiscalSourcePreparationProofInput) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const proofDigest = (value: Omit<FiscalSourcePreparationProof, "proofDigest">) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const conflict = () => new AppError(409, "FISCAL_COMMAND_CONFLICT");
const verifyIntegrity = (proof: FiscalSourcePreparationProof) => {
  const {
    proofDigest: established,
    consumedAt: _consumedAt,
    consumedBy: _consumedBy,
    ...current
  } = proof;
  const prepared = { ...current, status: "PREPARED" as const };
  if (proofDigest(prepared) !== established) throw conflict();
  return proof;
};

/** Platform-owned handoff persistence. It contains immutable Restaurants evidence,
 * but never mutates the commercial source and never grants provider execution. */
export class FiscalSourcePreparationProofService {
  private static proofKey(orgId: string, proofId: string) {
    return { PK: K.orgKey(orgId), SK: K.fiscalSourcePreparationProofSK("TEST", proofId) };
  }
  private static commandKey(orgId: string, commandId: string) {
    return { PK: K.orgKey(orgId), SK: K.fiscalSourcePreparationProofCommandSK("TEST", commandId) };
  }
  private static async readCommand(orgId: string, commandId: string) {
    const output = await dynamoClient.send(new GetItemCommand({
      TableName: table(), Key: marshall(this.commandKey(orgId, commandId)), ConsistentRead: true,
    }));
    return output.Item ? commandRecordSchema.parse(unmarshall(output.Item)) : undefined;
  }
  static async read(orgId: string, proofId: string) {
    const key = this.proofKey(orgId, proofId);
    const output = await dynamoClient.send(new GetItemCommand({
      TableName: table(), Key: marshall(key), ConsistentRead: true,
    }));
    if (!output.Item) return undefined;
    const record = proofRecordSchema.parse(unmarshall(output.Item));
    if (record.PK !== key.PK || record.SK !== key.SK || record.orgId !== orgId ||
      record.data.orgId !== orgId || record.data.proofId !== proofId) throw conflict();
    return verifyIntegrity(record.data);
  }
  static consumptionWrite(proof: FiscalSourcePreparationProof, approverUserId: string, now: string) {
    CognitoSubjectSchema.parse(approverUserId);
    return {
      Update: {
        TableName: table(),
        Key: marshall(this.proofKey(proof.orgId, proof.proofId)),
        UpdateExpression: "SET #data.#status = :consumed, #data.consumedAt = :now, #data.consumedBy = :actor",
        ConditionExpression:
          "entityType = :type AND orgId = :org AND #data = :proof AND #data.#status = :prepared AND #data.expiresAt > :now",
        ExpressionAttributeNames: { "#data": "data", "#status": "status" },
        ExpressionAttributeValues: marshall({
          ":consumed": "CONSUMED", ":prepared": "PREPARED",
          ":type": "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF",
          ":org": proof.orgId, ":proof": proof, ":now": now, ":actor": approverUserId,
        }),
      },
    };
  }
  static async create(raw: unknown) {
    const input = FiscalSourcePreparationProofInputSchema.parse(raw);
    const inputDigest = requestDigest(input);
    const previous = await this.readCommand(input.orgId, input.commandId);
    if (previous) {
      if (previous.data.requestDigest !== inputDigest) throw conflict();
      const established = await this.read(input.orgId, previous.data.proofId);
      if (!established || established.proofDigest !== previous.data.proofDigest) throw conflict();
      return established;
    }
    const proofId = randomUUID();
    const preparedAt = new Date().toISOString();
    const { commandId: _commandId, ...proofInput } = input;
    const unsigned = proofDataSchema.omit({ proofDigest: true }).parse({
      ...proofInput, proofId, preparedAt, status: "PREPARED",
    });
    const data = proofDataSchema.parse({ ...unsigned, proofDigest: proofDigest(unsigned) });
    const expiresAtEpochSeconds = Math.ceil(Date.parse(input.expiresAt) / 1000);
    const proofRecord = {
      ...this.proofKey(input.orgId, proofId), orgId: input.orgId,
      entityType: "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF" as const,
      expiresAtEpochSeconds, data,
    };
    const commandRecord = {
      ...this.commandKey(input.orgId, input.commandId), orgId: input.orgId,
      entityType: "PLATFORM_FISCAL_SOURCE_PREPARATION_PROOF_COMMAND" as const,
      expiresAtEpochSeconds,
      data: { commandId: input.commandId, requestDigest: inputDigest, proofId, proofDigest: data.proofDigest },
    };
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
        { Put: { TableName: table(), Item: marshall(proofRecord), ConditionExpression: "attribute_not_exists(PK)" } },
        { Put: { TableName: table(), Item: marshall(commandRecord), ConditionExpression: "attribute_not_exists(PK)" } },
      ] }));
      return data;
    } catch {
      const replay = await this.readCommand(input.orgId, input.commandId);
      if (!replay || replay.data.requestDigest !== inputDigest) throw conflict();
      const established = await this.read(input.orgId, replay.data.proofId);
      if (!established || established.proofDigest !== replay.data.proofDigest) throw conflict();
      return established;
    }
  }
  static async consume(input: { orgId: string; proofId: string; proofDigest: string; approverUserId: string }) {
    const parsed = z.object({ orgId: z.string().min(1), proofId: uuid, proofDigest: digest, approverUserId: CognitoSubjectSchema }).strict().parse(input);
    const proof = await this.read(parsed.orgId, parsed.proofId);
    const now = new Date().toISOString();
    if (!proof || proof.proofDigest !== parsed.proofDigest || proof.status !== "PREPARED" || Date.parse(proof.expiresAt) <= Date.parse(now))
      throw conflict();
    try {
      await dynamoClient.send(new UpdateItemCommand(this.consumptionWrite(
        proof, parsed.approverUserId, now,
      ).Update));
      return proofDataSchema.parse({ ...proof, status: "CONSUMED", consumedAt: now, consumedBy: parsed.approverUserId });
    } catch { throw conflict(); }
  }
}
