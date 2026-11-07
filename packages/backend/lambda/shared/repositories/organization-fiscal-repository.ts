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
} from "@liass-ohada/shared/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { AppError } from "../app-error";
import type { PlatformPrincipal } from "../authorization/platform-admin";

const ssm = new SSMClient({ maxAttempts: 1 });
const table = () => config.PLATFORM_TABLE_NAME;
const id = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const connectionRecord = z
  .object({
    PK: z.string(),
    SK: z.string(),
    orgId: id,
    entityType: z.literal("PLATFORM_FISCAL_CONNECTION"),
    data: OrganizationFiscalConnectionSchema,
    secretReference: z.string().optional(),
  })
  .strict()
  .refine((row) =>
    row.data.credentialStatus === "STORED_UNVERIFIED"
      ? !!row.secretReference
      : row.secretReference === undefined,
  );
const commandRecord = z
  .object({
    PK: z.string(),
    SK: z.string(),
    orgId: id,
    entityType: z.literal("PLATFORM_FISCAL_COMMAND"),
    actorId: z.string().uuid(),
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
  static async authorize(orgId: string, actorId: string, write = false) {
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
    return { canManage: member.role === "OWNER" };
  }
  private static membershipCheck(orgId: string, actorId: string) {
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
    const connections = (page.Items ?? []).map((item) => {
      const row = connectionRecord.parse(unmarshall(item));
      if (
        row.PK !== PK ||
        row.orgId !== orgId ||
        row.data.environment !== environment ||
        row.SK !==
          K.organizationFiscalConnectionSK(environment, row.data.connectionId)
      )
        throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
      return row.data;
    });
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
