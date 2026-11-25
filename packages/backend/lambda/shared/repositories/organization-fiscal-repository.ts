import { assertFiscalOrganization, fiscalOrganizationCheck } from "../authorization/fiscal-organization";
import { createHash } from "node:crypto";
import {
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import {
  OrganizationFiscalConnectionSchema,
  OrganizationFiscalSettingsSchema,
  PutOrganizationFiscalConnectionSchema,
  FiscalCredentialCommandSchema,
  SubmitFiscalCredentialSchema,
  EnrollmentEnvironmentSchema,
  FiscalIssuanceContextSchema,
  FiscalIssuancePolicySchema,
  PutFiscalIssuancePolicySchema,
  FiscalIssuanceBindingSchema,
} from "@liass-ohada/shared/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { AppError } from "../app-error";
import {
  CognitoSubjectSchema,
  type PlatformPrincipal,
} from "../authorization/platform-admin";
import { FiscalVerificationStateSchema, addressOnlyVerificationSuccessor, publicVerification } from "../services/fiscal-verification-model";
import { OrganizationLegalIdentityService } from "../services/organization-legal-identity-service";

const ssm = new SSMClient({ maxAttempts: 1 });
const table = () => config.PLATFORM_TABLE_NAME;
const id = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export const FiscalConnectionRecordSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    orgId: id,
    entityType: z.literal("PLATFORM_FISCAL_CONNECTION"),
    data: OrganizationFiscalConnectionSchema,
    secretReference: z.string().optional(),
    verification: FiscalVerificationStateSchema.optional(),
  })
  .strict()
  .refine((row) =>
    row.data.credentialStatus === "STORED_UNVERIFIED"
      ? !!row.secretReference
      : row.secretReference === undefined,
  );
const connectionRecord = FiscalConnectionRecordSchema;
export type FiscalConnectionRecord = z.infer<typeof FiscalConnectionRecordSchema>;
export const fiscalConfigurationDigest = (row: FiscalConnectionRecord) => createHash("sha256")
  .update(JSON.stringify([row.orgId, row.data, row.secretReference ?? null])).digest("hex");
const commandRecord = z
  .object({
    PK: z.string(),
    SK: z.string(),
    orgId: id,
    entityType: z.literal("PLATFORM_FISCAL_COMMAND"),
    actorId: CognitoSubjectSchema,
    intentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["PENDING_STORAGE", "COMMITTED"]),
    result: OrganizationFiscalConnectionSchema.optional(),
    secretReference: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
type Environment = z.infer<typeof EnrollmentEnvironmentSchema>;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const conflict = () => new AppError(409, "PLATFORM_FISCAL_CONFLICT");

/** Platform-owned enrollment metadata. Never consumed as fiscal issuance authority. */
export class OrganizationFiscalRepository {
  private static async get(PK: string, SK: string) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: table(),
        Key: marshall({ PK, SK }),
        ConsistentRead: true,
      }),
    );
    return result.Item ? unmarshall(result.Item) : undefined;
  }
  static async authorize(orgId: string, actorId: string, write = false, requireBenin = true) {
    id.parse(orgId);
    const member = await this.get(K.orgKey(orgId), K.orgUserAccessSK(actorId));
    if (
      !member ||
      member.entityType !== "USER_ORG_ACCESS" ||
      member.orgId !== orgId ||
      member.userId !== actorId ||
      member.status !== "ACTIVE" ||
      member.workspaceType !== "COMPANY" ||
      member.accessSource !== "DIRECT" ||
      (write && member.role !== "OWNER")
    )
      throw new AppError(403, "PLATFORM_FISCAL_FORBIDDEN");
    if (requireBenin) await assertFiscalOrganization(orgId);
    return { canManage: member.role === "OWNER" };
  }
  static membershipCheck(orgId: string, actorId: string) {
    return {
      ConditionCheck: {
        TableName: table(),
        Key: marshall({ PK: K.orgKey(orgId), SK: K.orgUserAccessSK(actorId) }),
        ConditionExpression:
          "entityType = :type AND orgId = :org AND userId = :user AND #status = :active AND #role = :owner AND workspaceType = :company AND accessSource = :direct",
        ExpressionAttributeNames: { "#status": "status", "#role": "role" },
        ExpressionAttributeValues: marshall({
          ":type": "USER_ORG_ACCESS",
          ":org": orgId,
          ":user": actorId,
          ":active": "ACTIVE",
          ":owner": "OWNER",
          ":company": "COMPANY",
          ":direct": "DIRECT",
        }),
      },
    };
  }
  private static async connection(
    orgId: string,
    environment: Environment,
    connectionId: string,
  ) {
    const PK = K.orgKey(orgId),
      SK = K.organizationFiscalConnectionSK(environment, connectionId);
    const raw = await this.get(PK, SK);
    if (!raw) return undefined;
    const row = connectionRecord.parse(raw);
    if (
      row.PK !== PK ||
      row.SK !== SK ||
      row.orgId !== orgId ||
      row.data.connectionId !== connectionId ||
      row.data.environment !== environment
    )
      throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
    return row;
  }
  static readForVerification(orgId: string, environment: Environment, connectionId: string) {
    return this.connection(orgId, environment, connectionId);
  }
  static async readIssuancePolicy(orgId: string, actorId: string, input: unknown) {
    await this.authorize(orgId, actorId);
    const { issuancePointId } = FiscalIssuanceContextSchema.parse(input);
    const row = await this.get(K.orgKey(orgId), K.organizationFiscalIssuancePolicySK(issuancePointId));
    if (!row) return null;
    const policy = FiscalIssuancePolicySchema.parse(row.data);
    if (row.entityType !== "PLATFORM_FISCAL_ISSUANCE_POLICY" || row.orgId !== orgId ||
      policy.issuancePointId !== issuancePointId)
      throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
    return policy;
  }
  static async putIssuancePolicy(orgId: string, actorId: string, input: unknown) {
    const { expectedVersion, ...change } = PutFiscalIssuancePolicySchema.parse(input);
    await this.authorize(orgId, actorId, true);
    const connection = await this.connection(orgId, change.environment, change.connectionId);
    if (!connection || (change.enabled && change.environment !== "TEST"))
      throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const policy = FiscalIssuancePolicySchema.parse({ ...change, version: expectedVersion + 1,
      updatedAt: new Date().toISOString(), updatedBy: actorId });
    if (policy.enabled) {
      const verified = connection.verification?.lastVerified;
      const identity = await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(orgId);
      if (!verified || !identity) throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
      const compatible = await addressOnlyVerificationSuccessor(orgId, verified, identity.binding);
      const evidence = publicVerification(verified, { digest: fiscalConfigurationDigest(connection),
        identity: identity.binding }, policy.updatedAt, compatible);
      if (evidence.status !== "VERIFIED_TEST" || !evidence.applicable || !evidence.checks.technicallyVerified)
        throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    }
    const PK = K.orgKey(orgId);
    const SK = K.organizationFiscalIssuancePolicySK(policy.issuancePointId);
    const item = { PK, SK, orgId, entityType: "PLATFORM_FISCAL_ISSUANCE_POLICY", data: policy };
    await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [
      this.membershipCheck(orgId, actorId), fiscalOrganizationCheck(orgId),
      ...(policy.enabled ? [this.executionCondition(connection)] : []),
      { Put: { TableName: table(), Item: marshall(item),
        ConditionExpression: expectedVersion === 0 ? "attribute_not_exists(PK)" :
          "entityType = :type AND orgId = :org AND #data.#version = :version",
        ...(expectedVersion === 0 ? {} : { ExpressionAttributeNames: { "#data": "data", "#version": "version" },
          ExpressionAttributeValues: marshall({ ":type": item.entityType, ":org": orgId, ":version": expectedVersion }) }) } },
      { Put: { TableName: table(), Item: marshall({ ...item, entityType: "PLATFORM_FISCAL_ISSUANCE_POLICY_REVISION",
        SK: K.organizationFiscalIssuancePolicyHistorySK(policy.issuancePointId, policy.version) }),
        ConditionExpression: "attribute_not_exists(PK)" } },
    ] }));
    return policy;
  }
  static async resolveIssuancePolicy(orgId: string, actorId: string, point?: string) {
    const scoped = point === undefined ? null : await this.readIssuancePolicy(orgId, actorId, { issuancePointId: point });
    const policy = scoped ??
      await this.readIssuancePolicy(orgId, actorId, {});
    if (!policy?.enabled || policy.environment !== "TEST") return null;
    const connection = await this.connection(orgId, policy.environment, policy.connectionId);
    const verified = connection?.verification?.lastVerified;
    const identity = await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(orgId);
    if (!connection?.secretReference || !verified || !identity.ifu || identity.ifu !== connection.data.taxpayerIfu) return null;
    const compatible = await addressOnlyVerificationSuccessor(orgId, verified, identity.binding);
    const evidence = publicVerification(verified, { digest: fiscalConfigurationDigest(connection),
      identity: identity.binding }, new Date().toISOString(), compatible);
    if (!evidence.applicable || evidence.status !== "VERIFIED_TEST" || !evidence.checks.technicallyVerified) return null;
    const binding = { environment: policy.environment, connectionId: policy.connectionId,
      policyVersion: policy.version, ...(policy.issuancePointId ? { issuancePointId: policy.issuancePointId } : {}) };
    const policyKey = (issuancePointId?: string) => marshall({ PK: K.orgKey(orgId),
      SK: K.organizationFiscalIssuancePolicySK(issuancePointId) });
    return { binding, sellerSelectionVersion: identity.binding.selectionVersion,
      checks: [this.executionCondition(connection), { ConditionCheck: {
      TableName: table(), Key: policyKey(policy.issuancePointId), ConditionExpression: "orgId = :org AND #data = :data",
      ExpressionAttributeNames: { "#data": "data" }, ExpressionAttributeValues: marshall({ ":org": orgId, ":data": policy }),
    } }, ...(point !== undefined && !policy.issuancePointId ? [{ ConditionCheck: { TableName: table(), Key: policyKey(point),
      ConditionExpression: "attribute_not_exists(PK)" } }] : [])] };
  }
  /** Resolve the immutable revision, then revalidate the live credential separately. */
  static async resolveBoundIssuanceConnection(orgId: string, input: unknown) {
    const binding = FiscalIssuanceBindingSchema.parse(input);
    if (binding.environment !== "TEST" || !["dev", "test"].includes(process.env.STAGE ?? ""))
      throw new AppError(403, "PLATFORM_FISCAL_FORBIDDEN");
    await assertFiscalOrganization(orgId);
    const PK = K.orgKey(orgId);
    const SK = K.organizationFiscalIssuancePolicyHistorySK(binding.issuancePointId, binding.policyVersion);
    const row = await this.get(PK, SK);
    const policy = FiscalIssuancePolicySchema.safeParse(row?.data);
    if (row?.PK !== PK || row.SK !== SK || row.orgId !== orgId ||
      row.entityType !== "PLATFORM_FISCAL_ISSUANCE_POLICY_REVISION" || !policy.success ||
      !policy.data.enabled || policy.data.version !== binding.policyVersion ||
      policy.data.connectionId !== binding.connectionId || policy.data.environment !== binding.environment ||
      policy.data.issuancePointId !== binding.issuancePointId)
      throw new AppError(403, "PLATFORM_FISCAL_FORBIDDEN");
    const connection = await this.connection(orgId, binding.environment, binding.connectionId);
    const verified = connection?.verification?.lastVerified;
    if (!connection?.secretReference || connection.data.credentialStatus !== "STORED_UNVERIFIED" || !verified)
      throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const identity = await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(orgId);
    const compatible = await addressOnlyVerificationSuccessor(orgId, verified, identity.binding);
    const evidence = publicVerification(verified, { digest: fiscalConfigurationDigest(connection),
      identity: identity.binding }, new Date().toISOString(), compatible);
    if (!identity.ifu || identity.ifu !== connection.data.taxpayerIfu ||
      evidence.status !== "VERIFIED_TEST" || !evidence.applicable || !evidence.checks.technicallyVerified)
      throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    return connection;
  }
  static executionCondition(row: FiscalConnectionRecord) {
    if (!row.verification || !row.secretReference)
      throw new AppError(409, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    return {
      ConditionCheck: {
        TableName: table(),
        Key: marshall({ PK: row.PK, SK: row.SK }),
        ConditionExpression:
          "entityType = :type AND orgId = :org AND #data = :data AND secretReference = :secret AND verification = :verification",
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: marshall({
          ":type": "PLATFORM_FISCAL_CONNECTION",
          ":org": row.orgId,
          ":data": row.data,
          ":secret": row.secretReference,
          ":verification": row.verification,
        }),
      },
    };
  }
  /** Resolve B2's immutable storage audit, not a customer-provided secret path. */
  static async credentialBinding(orgId: string, principal: PlatformPrincipal, row: FiscalConnectionRecord) {
    const reference = row.secretReference;
    const match = reference?.match(new RegExp(`^/${principal.stage}/platform/fiscal/${hash(orgId)}/${row.data.environment}/([A-Fa-f0-9-]{36})$`));
    if (!reference || !match || !z.string().uuid().safeParse(match[1]).success || row.data.credentialStatus !== "STORED_UNVERIFIED")
      throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const commandId = match[1];
    const raw = await this.get(K.orgKey(orgId), K.organizationFiscalCommandSK(row.data.environment, commandId));
    const command = commandRecord.parse(raw);
    if (command.PK !== K.orgKey(orgId) || command.SK !== K.organizationFiscalCommandSK(row.data.environment, commandId) ||
      command.orgId !== orgId || command.status !== "COMMITTED" || !command.result || command.result.connectionId !== row.data.connectionId ||
      command.result.environment !== row.data.environment || command.result.credentialStatus !== "STORED_UNVERIFIED" || command.result.version > row.data.version)
      throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const historySK = K.organizationFiscalHistorySK(row.data.environment, row.data.connectionId, command.result.version);
    const history = await this.get(K.orgKey(orgId), historySK);
    if (!history || history.PK !== K.orgKey(orgId) || history.SK !== historySK || history.orgId !== orgId ||
      history.entityType !== "PLATFORM_FISCAL_HISTORY" || history.action !== "STORE_CREDENTIAL" || history.commandId !== commandId || history.secretReference !== reference ||
      JSON.stringify(OrganizationFiscalConnectionSchema.parse(history.data)) !== JSON.stringify(command.result))
      throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    return { reference, version: 1 as const, storageVersion: command.result.version, commandId, intentDigest: command.intentDigest };
  }
  static async readVerificationCredential(row: FiscalConnectionRecord, binding: Awaited<ReturnType<typeof OrganizationFiscalRepository.credentialBinding>>) {
    const stored = await ssm.send(new GetParameterCommand({ Name: `${binding.reference}:${binding.version}`, WithDecryption: true }),
      { abortSignal: AbortSignal.timeout(5000) }).catch((error: unknown) => {
        if (["ParameterNotFound", "ParameterVersionNotFound"].includes((error as { name: string }).name))
          throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
        throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
      });
    if (stored.Parameter?.Type !== "SecureString" || stored.Parameter.Version !== binding.version ||
      (stored.Parameter.Name !== undefined && stored.Parameter.Name !== binding.reference)) throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const token = SubmitFiscalCredentialSchema.shape.token.safeParse(stored.Parameter.Value);
    if (!token.success) throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const intent = SubmitFiscalCredentialSchema.parse({ environment: row.data.environment, connectionId: row.data.connectionId,
      expectedVersion: binding.storageVersion - 1, commandId: binding.commandId, token: token.data });
    if (hash(JSON.stringify(["STORE_CREDENTIAL", intent])) !== binding.intentDigest) throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    return token.data;
  }
  /** Internal executor-only credential read. The caller must already have an
   * independently verified, expiring execution authorization. This method does
   * not select a connection and does not grant issuance authority. */
  static async readAuthorizedExecutionCredential(orgId: string, stage: PlatformPrincipal["stage"], connectionId: string) {
    const row = await this.connection(orgId, "TEST", connectionId);
    if (!row) throw new AppError(422, "PLATFORM_FISCAL_CREDENTIAL_INVALID");
    const binding = await this.credentialBinding(orgId, { stage, issuer: "https://executor.invalid", sub: "00000000-0000-0000-0000-000000000000" }, row);
    return { connection: row, token: await this.readVerificationCredential(row, binding) };
  }
  static async list(orgId: string, actorId: string, input: unknown) {
    const access = await this.authorize(orgId, actorId);
    const { environment, cursor } = z
      .object({
        environment: EnrollmentEnvironmentSchema,
        cursor: z.string().max(2048).optional(),
      })
      .strict()
      .parse(input);
    const PK = K.orgKey(orgId),
      prefix = K.organizationFiscalConnectionPrefix(environment);
    let start: { PK: string; SK: string } | undefined;
    if (cursor) {
      try {
        start = z
          .object({ PK: z.literal(PK), SK: z.string().startsWith(prefix) })
          .strict()
          .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
      } catch {
        throw new AppError(400, "ERROR_INVALID_INPUT");
      }
    }
    const page = await dynamoClient.send(
      new QueryCommand({
        TableName: table(),
        ConsistentRead: true,
        Limit: 50,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": PK, ":prefix": prefix }),
        ...(start ? { ExclusiveStartKey: marshall(start) } : {}),
      }),
    );
    const currentIdentity = (page.Items ?? []).some(item => !!unmarshall(item).verification)
      ? await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(orgId).catch(() => null) : null;
    const now = new Date().toISOString();
    const connections = await Promise.all((page.Items ?? []).map(async (item) => {
      const row = connectionRecord.parse(unmarshall(item));
      if (
        row.PK !== PK ||
        row.orgId !== orgId ||
        row.data.environment !== environment ||
        row.SK !==
          K.organizationFiscalConnectionSK(environment, row.data.connectionId)
      )
        throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
      if (!row.verification) return row.data;
      const current = { digest: fiscalConfigurationDigest(row), identity: currentIdentity?.binding ?? null };
      const latestCompatible = await addressOnlyVerificationSuccessor(orgId, row.verification.latest, current.identity);
      const lastCompatible = row.verification.lastVerified
        ? await addressOnlyVerificationSuccessor(orgId, row.verification.lastVerified, current.identity) : false;
      const latestAttempt = publicVerification(row.verification.latest, current, now, latestCompatible);
      if (latestAttempt.inProgress && Date.parse(row.verification.leaseUntil) <= Date.parse(now)) latestAttempt.inProgress = false;
      return { ...row.data, verification: { latestAttempt,
        ...(row.verification.lastVerified ? { lastVerified: publicVerification(row.verification.lastVerified, current, now, lastCompatible) } : {}) } };
    }));
    return OrganizationFiscalSettingsSchema.parse({
      environment,
      connections,
      canManage: access.canManage,
      ...(page.LastEvaluatedKey
        ? {
            nextCursor: Buffer.from(
              JSON.stringify(unmarshall(page.LastEvaluatedKey)),
            ).toString("base64url"),
          }
        : {}),
      readiness: {
        state: connections.some(
          (c) => c.credentialStatus === "STORED_UNVERIFIED",
        )
          ? "PENDING_VERIFICATION"
          : connections.length
            ? "INCOMPLETE"
            : "NOT_CONFIGURED",
        providerAuthentication: "UNVERIFIED",
        taxpayerIdentity: "UNVERIFIED",
        sellerAuthority: "UNVERIFIED",
        timezoneAuthority: "UNVERIFIED",
        establishmentAssociation: "UNVERIFIED",
        productionEligible: false,
        issuanceEligible: false,
      },
    });
  }
  private static async readCommand(
    orgId: string,
    actorId: string,
    environment: Environment,
    commandId: string,
    intentDigest: string,
  ) {
    const PK = K.orgKey(orgId),
      SK = K.organizationFiscalCommandSK(environment, commandId);
    const raw = await this.get(PK, SK);
    if (!raw) return undefined;
    const command = commandRecord.parse(raw);
    if (
      command.PK !== PK ||
      command.SK !== SK ||
      command.orgId !== orgId ||
      command.actorId !== actorId ||
      command.intentDigest !== intentDigest
    )
      throw conflict();
    if (command.status === "COMMITTED" && !command.result)
      throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
    return command;
  }
  static async change(
    orgId: string,
    principal: PlatformPrincipal,
    kind: "CONFIGURE" | "STORE_CREDENTIAL" | "REVOKE_CREDENTIAL",
    input: unknown,
  ) {
    await this.authorize(orgId, principal.sub, true);
    const request =
      kind === "CONFIGURE"
        ? PutOrganizationFiscalConnectionSchema.parse(input)
        : kind === "STORE_CREDENTIAL"
          ? SubmitFiscalCredentialSchema.parse(input)
          : FiscalCredentialCommandSchema.parse(input);
    const { connectionId, environment, expectedVersion, commandId } = request;
    // Sensitive input contributes only to an internal digest, never a log, response or audit payload.
    const intentDigest = hash(JSON.stringify([kind, request]));
    const existing = await this.readCommand(
      orgId,
      principal.sub,
      environment,
      commandId,
      intentDigest,
    );
    if (existing?.status === "COMMITTED") return existing.result!;
    const previous = await this.connection(orgId, environment, connectionId);
    if (
      (previous?.data.version ?? 0) !== expectedVersion ||
      (kind !== "CONFIGURE" && !previous)
    )
      throw conflict();
    const now = existing?.createdAt ?? new Date().toISOString();
    const PK = K.orgKey(orgId),
      commandSK = K.organizationFiscalCommandSK(environment, commandId);
    let secretReference = previous?.secretReference;
    let credentialStatus = previous?.data.credentialStatus ?? "ABSENT";
    if (kind === "STORE_CREDENTIAL") {
      const token = SubmitFiscalCredentialSchema.parse(request).token;
      // Immutable per-command name. No overwrite, no secret in DynamoDB, no implicit provider scope.
      secretReference = `/${principal.stage}/platform/fiscal/${hash(orgId)}/${environment}/${commandId}`;
      const pending = {
        PK,
        SK: commandSK,
        orgId,
        entityType: "PLATFORM_FISCAL_COMMAND",
        actorId: principal.sub,
        intentDigest,
        status: "PENDING_STORAGE",
        createdAt: now,
        secretReference,
      };
      if (!existing) {
        try {
          await dynamoClient.send(
            new PutItemCommand({
              TableName: table(),
              Item: marshall(pending),
              ConditionExpression: "attribute_not_exists(PK)",
            }),
          );
        } catch {
          const reserved = await this.readCommand(
            orgId,
            principal.sub,
            environment,
            commandId,
            intentDigest,
          );
          if (reserved?.status === "COMMITTED") return reserved.result!;
          if (!reserved) throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
        }
      } else if (existing.secretReference !== secretReference) throw conflict();
      try {
        await ssm.send(
          new PutParameterCommand({
            Name: secretReference,
            Type: "SecureString",
            Tier: "Standard",
            KeyId: "alias/aws/ssm",
            Value: token,
            Overwrite: false,
          }),
        );
      } catch (error) {
        if ((error as { name?: string }).name !== "ParameterAlreadyExists")
          throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
        try {
          const stored = await ssm.send(
            new GetParameterCommand({
              Name: secretReference,
              WithDecryption: true,
            }),
          );
          if (
            stored.Parameter?.Type !== "SecureString" ||
            stored.Parameter.Value !== token
          )
            throw new Error();
        } catch {
          throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
        }
      }
      credentialStatus = "STORED_UNVERIFIED";
    }
    if (kind === "REVOKE_CREDENTIAL") {
      secretReference = undefined;
      credentialStatus = "REVOKED";
    }
    // Changing IFU or NIM invalidates the old credential association; historical reference stays in the immutable revision.
    const fields =
      kind === "CONFIGURE"
        ? PutOrganizationFiscalConnectionSchema.parse(request)
        : previous!.data;
    if (
      kind === "CONFIGURE" &&
      previous &&
      (fields.taxpayerIfu !== previous.data.taxpayerIfu ||
        fields.nim !== previous.data.nim)
    ) {
      secretReference = undefined;
      credentialStatus = "ABSENT";
    }
    const data = OrganizationFiscalConnectionSchema.parse({
      environment,
      connectionId,
      label: fields.label,
      taxpayerIfu: fields.taxpayerIfu,
      nim: fields.nim,
      version: expectedVersion + 1,
      updatedAt: now,
      credentialStatus,
    });
    const current = {
      PK,
      SK: K.organizationFiscalConnectionSK(environment, connectionId),
      orgId,
      entityType: "PLATFORM_FISCAL_CONNECTION",
      data,
      ...(secretReference ? { secretReference } : {}),
    };
    const command = {
      PK,
      SK: commandSK,
      orgId,
      entityType: "PLATFORM_FISCAL_COMMAND",
      actorId: principal.sub,
      intentDigest,
      status: "COMMITTED",
      createdAt: now,
      result: data,
    };
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            this.membershipCheck(orgId, principal.sub),
            fiscalOrganizationCheck(orgId),
            {
              Put: {
                TableName: table(),
                Item: marshall(current, { removeUndefinedValues: true }),
                ConditionExpression:
                  expectedVersion === 0
                    ? "attribute_not_exists(PK)"
                    : "#data.#version = :version AND entityType = :type",
                ...(expectedVersion === 0
                  ? {}
                  : {
                      ExpressionAttributeNames: {
                        "#data": "data",
                        "#version": "version",
                      },
                      ExpressionAttributeValues: marshall({
                        ":version": expectedVersion,
                        ":type": "PLATFORM_FISCAL_CONNECTION",
                      }),
                    }),
              },
            },
            {
              Put: {
                TableName: table(),
                Item: marshall(
                  {
                    ...current,
                    SK: K.organizationFiscalHistorySK(
                      environment,
                      connectionId,
                      data.version,
                    ),
                    entityType: "PLATFORM_FISCAL_HISTORY",
                    actorId: principal.sub,
                    action: kind,
                    commandId,
                  },
                  { removeUndefinedValues: true },
                ),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: table(),
                Item: marshall(command, { removeUndefinedValues: true }),
                ConditionExpression:
                  kind === "STORE_CREDENTIAL"
                    ? "#status = :pending AND intentDigest = :intent AND actorId = :actor"
                    : "attribute_not_exists(PK)",
                ...(kind === "STORE_CREDENTIAL"
                  ? {
                      ExpressionAttributeNames: { "#status": "status" },
                      ExpressionAttributeValues: marshall({
                        ":pending": "PENDING_STORAGE",
                        ":intent": intentDigest,
                        ":actor": principal.sub,
                      }),
                    }
                  : {}),
              },
            },
          ],
        }),
      );
    } catch (error) {
      await this.authorize(orgId, principal.sub, true);
      const committed = await this.readCommand(
        orgId,
        principal.sub,
        environment,
        commandId,
        intentDigest,
      );
      if (committed?.status === "COMMITTED") return committed.result!;
      const failure = error as {
        name?: string;
        CancellationReasons?: { Code?: string }[];
      };
      if (
        failure.name === "TransactionCanceledException" &&
        failure.CancellationReasons?.some(
          (reason) => reason.Code === "ConditionalCheckFailed",
        )
      )
        throw conflict();
      throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
    }
    return data;
  }
}
