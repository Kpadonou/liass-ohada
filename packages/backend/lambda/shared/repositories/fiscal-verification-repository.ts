import { fiscalOrganizationCheck } from "../authorization/fiscal-organization";
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import {
  VerifyFiscalConnectionRequestSchema,
  FiscalVerificationResult,
} from "@liass-ohada/shared/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { AppError } from "../app-error";
import { hash, admission } from "../authority/integrity";
import {
  OrganizationFiscalRepository as Connections,
  FiscalConnectionRecord,
} from "./organization-fiscal-repository";
import {
  FiscalVerificationBindingSchema,
  FiscalVerificationState,
  initialVerification,
  StoredFiscalVerificationSchema,
} from "../services/fiscal-verification-model";
import {
  CognitoSubjectSchema,
  type PlatformPrincipal,
} from "../authorization/platform-admin";

const operationSchema = z
  .object({
    PK: z.string(),
    SK: z.string(),
    orgId: z.string(),
    entityType: z.literal("PLATFORM_FISCAL_VERIFICATION"),
    actorId: CognitoSubjectSchema,
    actorIssuer: z.string(),
    intentDigest: z.string(),
    stage: z.enum(["dev", "test", "prod"]),
    state: z.enum(["PENDING", "COMPLETE"]),
    binding: FiscalVerificationBindingSchema,
    result: StoredFiscalVerificationSchema.shape.result,
    leaseUntil: z.string().datetime(),
    revision: z.number().int().positive().safe(),
  })
  .strict();
type Operation = z.infer<typeof operationSchema>;
const table = () => config.PLATFORM_TABLE_NAME;
const conflict = () => new AppError(409, "PLATFORM_FISCAL_CONFLICT");
export const verificationLeaseMs = 45_000;
export class FiscalVerificationRepository {
  static async read(
    orgId: string,
    principal: PlatformPrincipal,
    input: z.infer<typeof VerifyFiscalConnectionRequestSchema>,
  ) {
    const key = {
      PK: K.orgKey(orgId),
      SK: K.organizationFiscalVerificationSK(
        input.environment,
        input.connectionId,
        input.commandId,
      ),
    };
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: table(),
        Key: marshall(key),
        ConsistentRead: true,
      }),
    );
    if (!response.Item) return undefined;
    const value = operationSchema.parse(unmarshall(response.Item));
    if (
      value.PK !== key.PK ||
      value.SK !== key.SK ||
      value.orgId !== orgId ||
      value.actorId !== principal.sub ||
      value.actorIssuer !== principal.issuer ||
      value.stage !== principal.stage ||
      value.intentDigest !== hash(JSON.stringify(input)) ||
      value.binding.connectionId !== input.connectionId ||
      value.binding.environment !== input.environment ||
      value.binding.orgId !== orgId ||
      value.result.operationId !== input.commandId ||
      value.result.environment !== value.binding.environment ||
      value.result.configurationVersion !== value.binding.configurationVersion
    )
      throw conflict();
    return value;
  }
  private static sourceCondition(
    source: FiscalConnectionRecord,
    previousRevision: number,
  ) {
    return {
      ConditionExpression:
        "#data = :snapshot AND entityType = :type AND orgId = :org AND " +
        (source.secretReference
          ? "secretReference = :secret"
          : "attribute_not_exists(secretReference)") +
        " AND " +
        (previousRevision
          ? "verification.revision = :revision"
          : "attribute_not_exists(verification)"),
      ExpressionAttributeNames: { "#data": "data" },
      ExpressionAttributeValues: marshall({
        ":snapshot": source.data,
        ":type": "PLATFORM_FISCAL_CONNECTION",
        ":org": source.orgId,
        ...(source.secretReference
          ? { ":secret": source.secretReference }
          : {}),
        ...(previousRevision ? { ":revision": previousRevision } : {}),
      }),
    };
  }
  static async reserve(
    orgId: string,
    principal: PlatformPrincipal,
    input: z.infer<typeof VerifyFiscalConnectionRequestSchema>,
    source: FiscalConnectionRecord,
    binding: z.infer<typeof FiscalVerificationBindingSchema>,
    now: string,
    identityCheck?: TransactWriteItem,
  ) {
    const previousRevision = source.verification?.revision ?? 0;
    if (
      source.verification?.latest.result.inProgress &&
      Date.parse(source.verification.leaseUntil) > Date.parse(now)
    )
      throw new AppError(409, "PLATFORM_FISCAL_VERIFICATION_BUSY");
    const result = initialVerification(input.commandId, binding, now);
    const operation = operationSchema.parse({
      PK: K.orgKey(orgId),
      SK: K.organizationFiscalVerificationSK(
        input.environment,
        input.connectionId,
        input.commandId,
      ),
      orgId,
      entityType: "PLATFORM_FISCAL_VERIFICATION",
      actorId: principal.sub,
      actorIssuer: principal.issuer,
      stage: principal.stage,
      intentDigest: hash(JSON.stringify(input)),
      state: "PENDING",
      binding,
      result,
      leaseUntil: new Date(Date.parse(now) + verificationLeaseMs).toISOString(),
      revision: previousRevision + 1,
    });
    const verification: FiscalVerificationState = {
      revision: operation.revision,
      leaseUntil: operation.leaseUntil,
      latest: { binding, result },
      ...(source.verification?.lastVerified
        ? { lastVerified: source.verification.lastVerified }
        : {}),
    };
    const current = { ...source, verification };
    admission(operation, 16 * 1024);
    admission(current, 32 * 1024);
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            Connections.membershipCheck(orgId, principal.sub),
            fiscalOrganizationCheck(orgId),
            {
              Put: {
                TableName: table(),
                Item: marshall(current, { removeUndefinedValues: true }),
                ...this.sourceCondition(source, previousRevision),
              },
            },
            {
              Put: {
                TableName: table(),
                Item: marshall(operation),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            ...(identityCheck ? [identityCheck] : []),
          ],
        }),
      );
    } catch {
      const existing = await this.read(orgId, principal, input);
      if (existing) return { operation: existing, owned: false };
      throw conflict();
    }
    return { operation, owned: true };
  }
  private static finalWrites(
    operation: Operation,
    result: FiscalVerificationResult,
  ): TransactWriteItem[] {
    const completed = { ...operation, state: "COMPLETE" as const, result };
    const audit = {
      ...completed,
      SK: K.organizationFiscalVerificationAuditSK(
        operation.binding.environment,
        operation.binding.connectionId,
        result.operationId,
      ),
      entityType: "PLATFORM_FISCAL_VERIFICATION_AUDIT",
    };
    admission(audit, 16 * 1024);
    return [
      {
        Put: {
          TableName: table(),
          Item: marshall(completed),
          ConditionExpression: "#state = :pending AND intentDigest = :intent",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: marshall({
            ":pending": "PENDING",
            ":intent": operation.intentDigest,
          }),
        },
      },
      {
        Put: {
          TableName: table(),
          Item: marshall(audit),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ];
  }
  static async finish(
    orgId: string,
    principal: PlatformPrincipal,
    input: z.infer<typeof VerifyFiscalConnectionRequestSchema>,
    source: FiscalConnectionRecord,
    operation: Operation,
    result: FiscalVerificationResult,
    identityCheck?: TransactWriteItem,
  ) {
    const writeCurrent = async (
      outcome: FiscalVerificationResult,
      guardIdentity: boolean,
    ) => {
      const lastVerified =
        outcome.status === "VERIFIED_TEST"
          ? { binding: operation.binding, result: outcome }
          : source.verification?.lastVerified;
      const verification: FiscalVerificationState = {
        revision: operation.revision,
        leaseUntil: operation.leaseUntil,
        latest: { binding: operation.binding, result: outcome },
        ...(lastVerified ? { lastVerified } : {}),
      };
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            Connections.membershipCheck(orgId, principal.sub),
            fiscalOrganizationCheck(orgId),
            {
              Put: {
                TableName: table(),
                Item: marshall(
                  { ...source, verification },
                  { removeUndefinedValues: true },
                ),
                ...this.sourceCondition(source, operation.revision),
              },
            },
            ...this.finalWrites(operation, outcome),
            ...(guardIdentity && identityCheck ? [identityCheck] : []),
          ],
        }),
      );
    };
    const conditional = (error: unknown) => {
      const failure = error as {
        name?: string;
        CancellationReasons?: { Code?: string }[];
      };
      return (
        failure.name === "TransactionCanceledException" &&
        failure.CancellationReasons?.some(
          (reason) => reason.Code === "ConditionalCheckFailed",
        )
      );
    };
    try {
      await writeCurrent(result, true);
      return result;
    } catch (error) {
      const established = await this.read(orgId, principal, input);
      if (established?.state === "COMPLETE") return established.result;
      if (!conditional(error))
        throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
      const stale: FiscalVerificationResult = {
        ...result,
        status: "STALE_CONFIGURATION",
        applicable: false,
        checks: { ...result.checks, technicallyVerified: false },
      };
      try {
        await writeCurrent(stale, false);
        return stale;
      } catch (failure) {
        const resolved = await this.read(orgId, principal, input);
        if (resolved?.state === "COMPLETE") return resolved.result;
        if (!conditional(failure))
          throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
        // Only historical outcome is finalized when the source/owner changed; the current connection is never repaired or reactivated.
        try {
          await dynamoClient.send(
            new TransactWriteItemsCommand({
              TransactItems: this.finalWrites(operation, stale),
            }),
          );
        } catch {
          const outcome = await this.read(orgId, principal, input);
          if (outcome?.state === "COMPLETE") return outcome.result;
          throw new AppError(503, "PLATFORM_FISCAL_UNAVAILABLE");
        }
        return stale;
      }
    }
  }
}
