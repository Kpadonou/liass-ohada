import { createHash, randomUUID } from "node:crypto";
import { GetItemCommand, TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import {
  ApproveFiscalTestExecutionAuthorizationRequestSchema,
  ExtendFiscalTestGetAuthorizationRequestSchema,
  FiscalTestGetAuthorizationExtensionViewSchema,
  FiscalTestExecutionAuthorizationViewSchema,
} from "@liass-ohada/shared/shared";
import { fiscalAttemptStateSchema, obligationIdentity } from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";
import { canonical } from "../authority/integrity";
import { AppError } from "../app-error";
import { dynamoClient, config } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import {
  fiscalConfigurationDigest,
  OrganizationFiscalRepository,
} from "../repositories/organization-fiscal-repository";
import { CognitoSubjectSchema, type PlatformPrincipal } from "../authorization/platform-admin";
import { FiscalSourcePreparationProofService } from "./fiscal-source-preparation-proof-service";
import { OrganizationLegalIdentityService } from "./organization-legal-identity-service";
import { publicVerification } from "./fiscal-verification-model";
import { fiscalOrganizationCheck } from "../authorization/fiscal-organization";
import { EffectiveOrganizationAccessService } from "./effective-organization-access-service";
import { DomainAuthorizationService } from "./domain-authorization-service";

const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const operation = z.enum(["CREATE", "GET", "CONFIRM", "CANCEL"]);
const mapping = z.unknown().refine(value => { try { const serialized = JSON.stringify(value); return typeof serialized === "string" && Buffer.byteLength(serialized) <= 32 * 1024; } catch { return false; } });
const totals = z.object({ ta: z.number().int().nonnegative(), tb: z.number().int().nonnegative(), tc: z.number().int().nonnegative(), td: z.number().int().nonnegative(), taa: z.number().int().nonnegative(), tab: z.number().int().nonnegative(), tac: z.number().int().nonnegative(), tad: z.number().int().nonnegative(), tae: z.number().int().nonnegative(), taf: z.number().int().nonnegative(), hab: z.number().int().nonnegative(), had: z.number().int().nonnegative(), vab: z.number().int().nonnegative(), vad: z.number().int().nonnegative(), aib: z.number().int().nonnegative(), ts: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict();
const authorizationInputBaseSchema = z.object({
  orgId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/), connectionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  outletId: id, operatorUserId: CognitoSubjectSchema, sessionId: id, invoiceId: id, creditNoteId: id.optional(),
  sourceDigest: digest, scenarioId: z.string().regex(/^([0-9]{2})$/), fiscalMapping: mapping, expectedFiscalTotals: totals,
  operations: z.record(operation, z.number().int().positive().max(10)).refine(v => Object.keys(v).length > 0),
  expiresAt: z.string().datetime(), commandId: id,
}).strict();
export const FiscalTestExecutionAuthorizationInputSchema = authorizationInputBaseSchema.superRefine((v, ctx) => { if (Date.parse(v.expiresAt) <= Date.now()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expiry must be future" }); });
export type FiscalTestExecutionAuthorizationInput = z.infer<typeof FiscalTestExecutionAuthorizationInputSchema>;
const dataSchema = authorizationInputBaseSchema.omit({ commandId: true }).extend({
  authorizationId: id, issuedAt: z.string().datetime(), issuedBy: CognitoSubjectSchema,
  status: z.enum(["ACTIVE", "REVOKED"]),
  remaining: z.record(operation, z.number().int().nonnegative()),
  revokedAt: z.string().datetime().optional(),
  preparationProofId: id.optional(), preparationProofDigest: digest.optional(),
  approvalCommandId: id.optional(), approvalIntentDigest: digest.optional(),
  connectionConfigurationDigest: digest.optional(), sellerAuthorityDigest: digest.optional(),
}).strict();
export type FiscalTestExecutionAuthorization = z.infer<typeof dataSchema>;
const recordSchema = z.object({ PK: z.string(), SK: z.string(), orgId: z.string(), entityType: z.literal("PLATFORM_FISCAL_EXECUTION_AUTHORIZATION"), data: dataSchema }).strict();
const extensionDataSchema = z.object({
  extensionId: id, authorizationId: id, orgId: z.string(), outletId: id,
  operatorUserId: CognitoSubjectSchema, sessionId: id, invoiceId: id,
  sourceDigest: digest, providerUid: z.string().min(1).max(256),
  expectedAttemptVersion: z.number().int().positive(), operation: z.literal("GET"),
  issuedAt: z.string().datetime(), issuedBy: CognitoSubjectSchema,
  expiresAt: z.string().datetime(), remaining: z.number().int().min(0).max(1),
  status: z.enum(["ACTIVE", "CONSUMED"]), commandId: id, intentDigest: digest,
}).strict();
const extensionRecordSchema = z.object({ PK: z.string(), SK: z.string(), orgId: z.string(),
  entityType: z.literal("PLATFORM_FISCAL_GET_AUTHORIZATION_EXTENSION"), data: extensionDataSchema,
  history: z.array(extensionDataSchema).max(10).optional() }).strict();
const extensionView = (data: z.infer<typeof extensionDataSchema>) =>
  FiscalTestGetAuthorizationExtensionViewSchema.parse({
    extensionId: data.extensionId, authorizationId: data.authorizationId,
    invoiceId: data.invoiceId, providerUid: data.providerUid,
    expectedAttemptVersion: data.expectedAttemptVersion, operation: data.operation,
    remaining: data.remaining, issuedAt: data.issuedAt, expiresAt: data.expiresAt,
    status: data.status,
  });
const table = () => config.PLATFORM_TABLE_NAME;
const keyFor = (v: Pick<FiscalTestExecutionAuthorizationInput, "orgId" | "invoiceId" | "creditNoteId">) => ({ PK: K.orgKey(v.orgId), SK: K.fiscalExecutionAuthorizationSK("TEST", v.creditNoteId ?? v.invoiceId) });
const extensionKeyFor = (orgId: string, invoiceId: string) => ({ PK: K.orgKey(orgId),
  SK: K.fiscalGetAuthorizationExtensionSK("TEST", invoiceId) });
const forbidden = () => new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
const conflict = () => new AppError(409, "FISCAL_COMMAND_CONFLICT");
const proofScenarios = new Set([
  "01", "02", "03", "04", "05", "07", "08", "09", "10",
  "12", "13", "14", "15", "16", "17", "19",
]);
const proofOperations = { CREATE: 1, GET: 2, CONFIRM: 1, CANCEL: 1 } as const;
const proofMappingBinding = z.object({
  environment: z.literal("TEST"),
  invoiceType: z.enum(["FV", "EV"]),
  priceBasis: z.literal("TTC"),
}).passthrough();

/** Explicit TEST-only authority. A fiscal connection is resolved only after this
 * record passes all bindings; possessing a connection never authorizes issuance. */
export class FiscalTestExecutionAuthorizationService {
  private static async read(key: { PK: string; SK: string }) {
    const out = await dynamoClient.send(new GetItemCommand({ TableName: table(), Key: marshall(key), ConsistentRead: true }));
    return out.Item ? recordSchema.parse(unmarshall(out.Item)) : undefined;
  }
  private static async readExtension(orgId: string, invoiceId: string) {
    const out = await dynamoClient.send(new GetItemCommand({ TableName: table(),
      Key: marshall(extensionKeyFor(orgId, invoiceId)), ConsistentRead: true }));
    return out.Item ? extensionRecordSchema.parse(unmarshall(out.Item)) : undefined;
  }
  static async extendGetReconciliation(principal: PlatformPrincipal, orgId: string, raw: unknown) {
    const request = ExtendFiscalTestGetAuthorizationRequestSchema.parse(raw);
    if (principal.stage === "prod") throw forbidden();
    const access = await EffectiveOrganizationAccessService.resolveAccess({ orgId,
      userId: principal.sub, workspaceOrgId: orgId });
    if (access.accessSource !== "DIRECT" || access.workspaceOrgId !== orgId) throw forbidden();
    DomainAuthorizationService.assertPermission(access, "FISCAL_COMPLIANCE_WRITE");
    await OrganizationFiscalRepository.authorize(orgId, principal.sub, true);
    const originalKey = keyFor({ orgId, invoiceId: request.invoiceId });
    const original = await this.read(originalKey);
    if (!original || original.data.authorizationId !== request.authorizationId ||
      original.data.invoiceId !== request.invoiceId || original.data.status !== "ACTIVE" ||
      original.data.remaining.CREATE !== 0 || original.data.remaining.GET !== 0) {
      console.error(JSON.stringify({ event: "FISCAL_GET_AUTHORIZATION_EXTENSION_REJECTED", reason: "BASE_AUTHORIZATION" }));
      throw conflict();
    }
    const intentDigest = createHash("sha256").update(canonical({
      orgId, issuedBy: principal.sub, ...request,
    })).digest("hex");
    const existing = await this.readExtension(orgId, request.invoiceId);
    if (existing) {
      if (existing.data.authorizationId !== request.authorizationId ||
        existing.data.issuedBy !== principal.sub) {
        console.error(JSON.stringify({ event: "FISCAL_GET_AUTHORIZATION_EXTENSION_REJECTED", reason: "AUDIT_BINDING" }));
        throw conflict();
      }
      if (existing.data.commandId === request.commandId) {
        if (existing.data.intentDigest !== intentDigest)
          throw conflict();
        return extensionView(existing.data);
      }
      const renewableExpired = existing.data.status === "ACTIVE" && existing.data.remaining === 1 &&
        Date.parse(existing.data.expiresAt) <= Date.now();
      const renewableConsumed = existing.data.status === "CONSUMED" && existing.data.remaining === 0;
      if ((!renewableExpired && !renewableConsumed) || (existing.history?.length ?? 0) >= 10) {
        console.error(JSON.stringify({ event: "FISCAL_GET_AUTHORIZATION_EXTENSION_REJECTED", reason: "RENEWAL_STATE" }));
        throw conflict();
      }
    }
    const identity = { orgId, environment: "TEST" as const, sourceDomain: "restaurants",
      sourceDocumentType: "INVOICE" as const, sourceDocumentId: request.invoiceId,
      jurisdiction: "BJ", obligation: "NORMALIZE" };
    const attemptKey = { PK: K.orgKey(orgId),
      SK: K.fiscalAttemptEffectSK("TEST", obligationIdentity(identity)) };
    const attemptOut = await dynamoClient.send(new GetItemCommand({ TableName: table(),
      Key: marshall(attemptKey), ConsistentRead: true }));
    if (!attemptOut.Item) throw conflict();
    const attemptRow = unmarshall(attemptOut.Item);
    const attempt = fiscalAttemptStateSchema.safeParse(attemptRow.state);
    if (attemptRow.entityType !== "FISCAL_ATTEMPT_EFFECT" || attemptRow.orgId !== orgId ||
      attemptRow.version !== request.expectedAttemptVersion || !attempt.success ||
      attempt.data.version !== request.expectedAttemptVersion || attempt.data.status !== "CREATED" ||
      attempt.data.uid !== request.providerUid || attempt.data.sourceDigest !== original.data.sourceDigest) {
      console.error(JSON.stringify({ event: "FISCAL_GET_AUTHORIZATION_EXTENSION_REJECTED", reason: "ATTEMPT_FENCE" }));
      throw conflict();
    }
    const issuedAt = new Date().toISOString();
    const data = extensionDataSchema.parse({ extensionId: randomUUID(),
      authorizationId: request.authorizationId, orgId, outletId: original.data.outletId,
      operatorUserId: original.data.operatorUserId, sessionId: original.data.sessionId,
      invoiceId: request.invoiceId, sourceDigest: original.data.sourceDigest,
      providerUid: request.providerUid, expectedAttemptVersion: request.expectedAttemptVersion,
      operation: "GET", issuedAt, issuedBy: principal.sub,
      expiresAt: new Date(Date.parse(issuedAt) + 30 * 60 * 1000).toISOString(),
      remaining: 1, status: "ACTIVE", commandId: request.commandId, intentDigest });
    const record = { ...extensionKeyFor(orgId, request.invoiceId), orgId,
      entityType: "PLATFORM_FISCAL_GET_AUTHORIZATION_EXTENSION" as const, data };
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
        OrganizationFiscalRepository.membershipCheck(orgId, principal.sub),
        fiscalOrganizationCheck(orgId),
        { ConditionCheck: { TableName: table(), Key: marshall(originalKey),
          ConditionExpression: "entityType = :type AND #data.authorizationId = :authorization AND #data.#status = :active AND #data.#remaining.#create = :zero AND #data.#remaining.#get = :zero",
          ExpressionAttributeNames: { "#data": "data", "#status": "status", "#remaining": "remaining", "#create": "CREATE", "#get": "GET" },
          ExpressionAttributeValues: marshall({ ":type": "PLATFORM_FISCAL_EXECUTION_AUTHORIZATION", ":authorization": request.authorizationId, ":active": "ACTIVE", ":zero": 0 }) } },
        { ConditionCheck: { TableName: table(), Key: marshall(attemptKey),
          ConditionExpression: "entityType = :type AND orgId = :org AND #version = :version AND #state.#status = :created AND #state.uid = :uid AND #state.sourceDigest = :source",
          ExpressionAttributeNames: { "#version": "version", "#state": "state", "#status": "status" },
          ExpressionAttributeValues: marshall({ ":type": "FISCAL_ATTEMPT_EFFECT", ":org": orgId,
            ":version": request.expectedAttemptVersion, ":created": "CREATED",
            ":uid": request.providerUid, ":source": original.data.sourceDigest }) } },
        existing ? { Update: { TableName: table(), Key: marshall(extensionKeyFor(orgId, request.invoiceId)),
          UpdateExpression: "SET #data = :data, #history = list_append(if_not_exists(#history, :empty), :previous)",
          ConditionExpression: "entityType = :type AND #data.commandId = :priorCommand AND ((#data.#status = :active AND #data.#remaining = :one AND #data.expiresAt <= :now) OR (#data.#status = :consumed AND #data.#remaining = :zero)) AND (attribute_not_exists(#history) OR size(#history) < :maxHistory)",
          ExpressionAttributeNames: { "#data": "data", "#history": "history", "#status": "status", "#remaining": "remaining" },
          ExpressionAttributeValues: marshall({ ":data": data, ":empty": [], ":previous": [existing.data],
            ":type": "PLATFORM_FISCAL_GET_AUTHORIZATION_EXTENSION", ":priorCommand": existing.data.commandId,
            ":active": "ACTIVE", ":consumed": "CONSUMED", ":one": 1, ":zero": 0,
            ":now": issuedAt, ":maxHistory": 10 }) } }
          : { Put: { TableName: table(), Item: marshall(record),
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      ] }));
    } catch (error) {
      const cancellationReasons = error && typeof error === "object" && "CancellationReasons" in error &&
        Array.isArray(error.CancellationReasons)
        ? error.CancellationReasons.map((reason) => reason && typeof reason === "object" && "Code" in reason
          ? String(reason.Code) : "UNKNOWN") : undefined;
      console.error(JSON.stringify({ event: "FISCAL_GET_AUTHORIZATION_EXTENSION_WRITE_FAILED",
        errorName: error instanceof Error ? error.name : "UNKNOWN", cancellationReasons }));
      const committed = await this.readExtension(orgId, request.invoiceId);
      if (committed && committed.data.commandId === request.commandId &&
        committed.data.intentDigest === intentDigest && committed.data.issuedBy === principal.sub)
        return extensionView(committed.data);
      throw conflict();
    }
    return extensionView(data);
  }
  static async approvePreparedProof(
    principal: PlatformPrincipal,
    orgId: string,
    raw: unknown,
  ) {
    const request = ApproveFiscalTestExecutionAuthorizationRequestSchema.parse(raw);
    if (principal.stage === "prod") throw forbidden();
    const access = await EffectiveOrganizationAccessService.resolveAccess({
      orgId,
      userId: principal.sub,
      workspaceOrgId: orgId,
    });
    if (access.accessSource !== "DIRECT" || access.workspaceOrgId !== orgId)
      throw forbidden();
    DomainAuthorizationService.assertPermission(
      access,
      "FISCAL_COMPLIANCE_WRITE",
    );
    await OrganizationFiscalRepository.authorize(orgId, principal.sub, true);
    const proof = await FiscalSourcePreparationProofService.read(orgId, request.proofId);
    if (!proof || proof.proofDigest !== request.proofDigest) throw conflict();
    const key = keyFor(proof);
    const established = await this.read(key);
    const intentDigest = createHash("sha256").update(canonical({
      orgId, approverUserId: principal.sub, ...request,
    })).digest("hex");
    const replay = () => {
      if (!established) return undefined;
      if (
        established.data.preparationProofId !== proof.proofId ||
        established.data.preparationProofDigest !== proof.proofDigest ||
        established.data.approvalCommandId !== request.commandId ||
        established.data.approvalIntentDigest !== intentDigest ||
        established.data.issuedBy !== principal.sub
      ) throw conflict();
      return established.data;
    };
    const previous = replay();
    if (previous) return this.view(previous);
    const now = new Date().toISOString();
    const remainingLifetime = Date.parse(proof.expiresAt) - Date.parse(now);
    if (
      proof.status !== "PREPARED" || remainingLifetime <= 0 ||
      remainingLifetime > 30 * 60 * 1000 ||
      !proofMappingBinding.safeParse(proof.fiscalMapping).success ||
      !proofScenarios.has(proof.scenarioId) ||
      canonical(proof.operations) !== canonical(proofOperations)
    ) throw conflict();
    const identity = await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(orgId)
      .catch(() => { throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID"); });
    if (!identity.ifu || identity.binding.digest !== proof.sellerAuthorityDigest)
      throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const connection = await OrganizationFiscalRepository.readForVerification(
      orgId, "TEST", request.connectionId,
    );
    if (!connection || connection.data.credentialStatus !== "STORED_UNVERIFIED" ||
      !connection.data.nim || !connection.secretReference || !connection.verification?.lastVerified)
      throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const configurationDigest = fiscalConfigurationDigest(connection);
    const verification = publicVerification(
      connection.verification.lastVerified,
      { digest: configurationDigest, identity: identity.binding },
      now,
    );
    const verifiedBinding = connection.verification.lastVerified.binding;
    if (
      verification.status !== "VERIFIED_TEST" || !verification.applicable ||
      !verification.checks.technicallyVerified || verification.checks.notExpired !== true ||
      verification.checks.ifuConsistency !== "MATCH" ||
      verification.checks.nimCorrespondence !== "MATCH" ||
      verifiedBinding.orgId !== orgId || verifiedBinding.connectionId !== request.connectionId ||
      verifiedBinding.environment !== "TEST" ||
      verifiedBinding.configurationVersion !== connection.data.version ||
      verifiedBinding.configurationDigest !== configurationDigest ||
      verifiedBinding.identity?.digest !== proof.sellerAuthorityDigest
    ) throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const input = FiscalTestExecutionAuthorizationInputSchema.parse({
      orgId, connectionId: request.connectionId,
      outletId: proof.outletId, operatorUserId: proof.operatorUserId,
      sessionId: proof.sessionId, invoiceId: proof.invoiceId,
      sourceDigest: proof.sourceDigest, scenarioId: proof.scenarioId,
      fiscalMapping: proof.fiscalMapping,
      expectedFiscalTotals: proof.expectedFiscalTotals,
      operations: proof.operations, expiresAt: proof.expiresAt,
      commandId: request.commandId,
    });
    const { commandId: _commandId, ...authorizationInput } = input;
    const data = dataSchema.parse({
      ...authorizationInput, authorizationId: randomUUID(), issuedAt: now,
      issuedBy: principal.sub, status: "ACTIVE", remaining: input.operations,
      preparationProofId: proof.proofId,
      preparationProofDigest: proof.proofDigest,
      approvalCommandId: request.commandId, approvalIntentDigest: intentDigest,
      connectionConfigurationDigest: configurationDigest,
      sellerAuthorityDigest: proof.sellerAuthorityDigest,
    });
    const record = {
      ...key, orgId, entityType: "PLATFORM_FISCAL_EXECUTION_AUTHORIZATION" as const, data,
    };
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
        OrganizationFiscalRepository.membershipCheck(orgId, principal.sub),
        fiscalOrganizationCheck(orgId),
        OrganizationFiscalRepository.executionCondition(connection),
        identity.check,
        FiscalSourcePreparationProofService.consumptionWrite(proof, principal.sub, now),
        { Put: {
          TableName: table(), Item: marshall(record),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        } },
      ] }));
    } catch (error) {
      const committed = await this.read(key);
      if (committed) {
        if (
          committed.data.preparationProofId === proof.proofId &&
          committed.data.preparationProofDigest === proof.proofDigest &&
          committed.data.approvalCommandId === request.commandId &&
          committed.data.approvalIntentDigest === intentDigest &&
          committed.data.issuedBy === principal.sub
        ) return this.view(committed.data);
        throw conflict();
      }
      const cancelled = error as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (cancelled.name === "TransactionCanceledException" &&
        cancelled.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed"))
        throw conflict();
      throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
    }
    return this.view(data);
  }
  private static view(data: FiscalTestExecutionAuthorization) {
    if (!data.preparationProofId) throw conflict();
    return FiscalTestExecutionAuthorizationViewSchema.parse({
      authorizationId: data.authorizationId,
      proofId: data.preparationProofId,
      invoiceId: data.invoiceId,
      scenarioId: data.scenarioId,
      connectionId: data.connectionId,
      expiresAt: data.expiresAt,
      operations: data.operations,
      remaining: data.remaining,
      status: data.status,
    });
  }
  static async revoke(principal: PlatformPrincipal, binding: Pick<FiscalTestExecutionAuthorizationInput, "orgId" | "invoiceId" | "creditNoteId">) {
    if (principal.stage === "prod" || binding.orgId.length === 0) throw forbidden();
    const access = await EffectiveOrganizationAccessService.resolveAccess({
      orgId: binding.orgId,
      userId: principal.sub,
      workspaceOrgId: binding.orgId,
    });
    if (access.accessSource !== "DIRECT" || access.workspaceOrgId !== binding.orgId)
      throw forbidden();
    DomainAuthorizationService.assertPermission(
      access,
      "FISCAL_COMPLIANCE_WRITE",
    );
    await OrganizationFiscalRepository.authorize(binding.orgId, principal.sub, true);
    const key = keyFor(binding);
    try { await dynamoClient.send(new UpdateItemCommand({ TableName: table(), Key: marshall(key), UpdateExpression: "SET #data.#status = :revoked, #data.revokedAt = :now", ConditionExpression: "entityType = :type AND #data.#status = :active", ExpressionAttributeNames: { "#data": "data", "#status": "status" }, ExpressionAttributeValues: marshall({ ":revoked": "REVOKED", ":active": "ACTIVE", ":type": "PLATFORM_FISCAL_EXECUTION_AUTHORIZATION", ":now": new Date().toISOString() }) })); } catch { throw new AppError(409, "FISCAL_COMMAND_CONFLICT"); }
  }
  private static async consumeGetExtension(binding: Pick<FiscalTestExecutionAuthorizationInput,
    "orgId" | "outletId" | "operatorUserId" | "sessionId" | "invoiceId" | "creditNoteId" | "sourceDigest">,
    original: FiscalTestExecutionAuthorization) {
    if (binding.creditNoteId) throw forbidden();
    const extension = await this.readExtension(binding.orgId, binding.invoiceId);
    const now = new Date().toISOString();
    if (!extension || extension.orgId !== binding.orgId || extension.data.status !== "ACTIVE" ||
      Date.parse(extension.data.expiresAt) <= Date.parse(now) || extension.data.remaining !== 1 ||
      extension.data.authorizationId !== original.authorizationId ||
      extension.data.outletId !== binding.outletId ||
      extension.data.operatorUserId !== binding.operatorUserId ||
      extension.data.sessionId !== binding.sessionId || extension.data.invoiceId !== binding.invoiceId ||
      extension.data.sourceDigest !== binding.sourceDigest) throw forbidden();
    const identity = { orgId: binding.orgId, environment: "TEST" as const,
      sourceDomain: "restaurants", sourceDocumentType: "INVOICE" as const,
      sourceDocumentId: binding.invoiceId, jurisdiction: "BJ", obligation: "NORMALIZE" };
    const attemptKey = { PK: K.orgKey(binding.orgId),
      SK: K.fiscalAttemptEffectSK("TEST", obligationIdentity(identity)) };
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
        { Update: { TableName: table(), Key: marshall(extensionKeyFor(binding.orgId, binding.invoiceId)),
          UpdateExpression: "SET #data.#remaining = :zero, #data.#status = :consumed",
          ConditionExpression: "entityType = :type AND #data.#status = :active AND #data.#remaining = :one AND #data.expiresAt > :now AND #data.authorizationId = :authorization",
          ExpressionAttributeNames: { "#data": "data", "#remaining": "remaining", "#status": "status" },
          ExpressionAttributeValues: marshall({ ":type": "PLATFORM_FISCAL_GET_AUTHORIZATION_EXTENSION",
            ":active": "ACTIVE", ":consumed": "CONSUMED", ":one": 1, ":zero": 0,
            ":now": now, ":authorization": original.authorizationId }) } },
        { ConditionCheck: { TableName: table(), Key: marshall(attemptKey),
          ConditionExpression: "entityType = :type AND orgId = :org AND #version = :version AND #state.#status = :created AND #state.uid = :uid AND #state.sourceDigest = :source",
          ExpressionAttributeNames: { "#version": "version", "#state": "state", "#status": "status" },
          ExpressionAttributeValues: marshall({ ":type": "FISCAL_ATTEMPT_EFFECT", ":org": binding.orgId,
            ":version": extension.data.expectedAttemptVersion, ":created": "CREATED",
            ":uid": extension.data.providerUid, ":source": binding.sourceDigest }) } },
      ] }));
    } catch { throw forbidden(); }
    return original;
  }
  static async resolveAndConsume(binding: Pick<FiscalTestExecutionAuthorizationInput, "orgId" | "outletId" | "operatorUserId" | "sessionId" | "invoiceId" | "creditNoteId" | "sourceDigest">, action: z.infer<typeof operation>) {
    const key = keyFor(binding); const row = await this.read(key); const now = new Date().toISOString();
    if (!row || row.orgId !== binding.orgId || row.data.status !== "ACTIVE" || row.data.outletId !== binding.outletId || row.data.operatorUserId !== binding.operatorUserId || row.data.sessionId !== binding.sessionId || row.data.invoiceId !== binding.invoiceId || row.data.creditNoteId !== binding.creditNoteId || row.data.sourceDigest !== binding.sourceDigest || row.data.remaining[action] === undefined) throw forbidden();
    if (action === "GET" && (Date.parse(row.data.expiresAt) <= Date.parse(now) || (row.data.remaining.GET ?? 0) < 1))
      return this.consumeGetExtension(binding, row.data);
    if (Date.parse(row.data.expiresAt) <= Date.parse(now)) throw forbidden();
    const remaining = row.data.remaining[action] ?? 0; if (remaining < 1) throw forbidden();
    try { await dynamoClient.send(new UpdateItemCommand({ TableName: table(), Key: marshall(key), UpdateExpression: "SET #data.#remaining.#action = #data.#remaining.#action - :one", ConditionExpression: "entityType = :type AND #data.#status = :active AND #data.#remaining.#action >= :one AND #data.#expiresAt > :now", ExpressionAttributeNames: { "#data": "data", "#remaining": "remaining", "#action": action, "#status": "status", "#expiresAt": "expiresAt" }, ExpressionAttributeValues: marshall({ ":one": 1, ":active": "ACTIVE", ":type": "PLATFORM_FISCAL_EXECUTION_AUTHORIZATION", ":now": now }) })); } catch { throw forbidden(); }
    return row.data;
  }
  static async resolve(binding: Pick<FiscalTestExecutionAuthorizationInput, "orgId" | "outletId" | "operatorUserId" | "sessionId" | "invoiceId" | "creditNoteId" | "sourceDigest">) {
    // READ is deliberately budgeted: an authorization cannot become a standing provider probe capability.
    return this.resolveAndConsume(binding, "GET");
  }
  static async readBound(binding: Pick<FiscalTestExecutionAuthorizationInput, "orgId" | "outletId" | "operatorUserId" | "sessionId" | "invoiceId" | "creditNoteId" | "sourceDigest">) {
    const row = await this.read(keyFor(binding)); const now = Date.now();
    if (!row || row.orgId !== binding.orgId || row.data.status !== "ACTIVE" || row.data.outletId !== binding.outletId || row.data.operatorUserId !== binding.operatorUserId || row.data.sessionId !== binding.sessionId || row.data.invoiceId !== binding.invoiceId || row.data.creditNoteId !== binding.creditNoteId || row.data.sourceDigest !== binding.sourceDigest) throw forbidden();
    if (Date.parse(row.data.expiresAt) <= now) {
      if (binding.creditNoteId) throw forbidden();
      const extension = await this.readExtension(binding.orgId, binding.invoiceId);
      if (!extension || extension.data.status !== "ACTIVE" || extension.data.remaining !== 1 ||
        Date.parse(extension.data.expiresAt) <= now ||
        extension.data.authorizationId !== row.data.authorizationId ||
        extension.data.outletId !== binding.outletId ||
        extension.data.operatorUserId !== binding.operatorUserId ||
        extension.data.sessionId !== binding.sessionId ||
        extension.data.invoiceId !== binding.invoiceId ||
        extension.data.sourceDigest !== binding.sourceDigest) throw forbidden();
    }
    return row.data;
  }
  static mappingDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
}
