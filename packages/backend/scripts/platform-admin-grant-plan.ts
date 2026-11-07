/** Offline only. Prints an IAM-operated transaction plan; never calls AWS or promotes a user.
 * Operator must separately verify Cognito issuer/sub, account, table and stage, obtain approval,
 * then use a short-lived IAM role restricted to PLATFORM_ADMIN#{stage}#* on that table.
 * Revocation writes a versioned tombstone (never delete/recreate version 1).
 */
import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { PlatformGrantSchema, PlatformPrincipalSchema, platformPrincipalDigest, PLATFORM_SFE_APPROVAL_MANAGE } from "../lambda/shared/authorization/platform-admin";
import { KeyFactory as K } from "../lambda/shared/key-builder";

export const GrantPlanInputSchema = PlatformPrincipalSchema.extend({
  tableName: z.string().min(3).max(255),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  action: z.enum(["GRANT", "REVOKE"]),
  changedByIamArn: z.string().regex(/^arn:aws:(iam|sts)::\d{12}:.+$/),
  changedAt: z.string().datetime(),
}).strict();
export function platformAdminGrantPlan(input: unknown) {
  const request = GrantPlanInputSchema.parse(input);
  if (request.action === "REVOKE" && request.expectedVersion === 0) throw new Error("Existing grant version required");
  const data = PlatformGrantSchema.parse({
    stage: request.stage, issuer: request.issuer, sub: request.sub,
    permission: PLATFORM_SFE_APPROVAL_MANAGE, status: request.action === "GRANT" ? "ACTIVE" : "REVOKED",
    revokedAt: request.action === "GRANT" ? null : request.changedAt,
    version: request.expectedVersion + 1, updatedAt: request.changedAt, changedByIamArn: request.changedByIamArn,
  });
  const PK = K.platformAdminPK(request.stage, platformPrincipalDigest(data));
  return { TransactItems: [
    { Put: { TableName: request.tableName,
      Item: marshall({ PK, SK: K.platformAdminGrantSK(), entityType: "PLATFORM_ADMIN_GRANT", data }),
      ConditionExpression: request.expectedVersion === 0 ? "attribute_not_exists(PK)" : "#data.#version = :version AND entityType = :type",
      ...(request.expectedVersion === 0 ? {} : {
        ExpressionAttributeNames: { "#data": "data", "#version": "version" },
        ExpressionAttributeValues: marshall({ ":version": request.expectedVersion, ":type": "PLATFORM_ADMIN_GRANT" }),
      }),
    } },
    { Put: { TableName: request.tableName,
      Item: marshall({ PK, SK: K.platformAdminGrantHistorySK(data.version), entityType: "PLATFORM_ADMIN_GRANT_HISTORY", data }),
      ConditionExpression: "attribute_not_exists(PK)",
    } },
  ] };
}
if (require.main === module) {
  // Read a reviewed input from stdin. No token/email/group or grant-management API exists.
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { input += chunk; if (input.length > 8192) process.exit(1); });
  process.stdin.on("end", () => {
    try { process.stdout.write(JSON.stringify(platformAdminGrantPlan(JSON.parse(input)), null, 2) + "\n"); }
    catch { process.stderr.write("Invalid grant plan input. No AWS operation performed.\n"); process.exitCode = 1; }
  });
}
