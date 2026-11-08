import { createHash } from "node:crypto";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { z } from "zod";
import { AppError } from "../app-error";

export const PLATFORM_SFE_APPROVAL_MANAGE = "PLATFORM_SFE_APPROVAL_MANAGE" as const;
export const PlatformStageSchema = z.enum(["dev", "test", "prod"]);
/** Cognito subjects are UUID-shaped but are not guaranteed to satisfy RFC UUID version/variant bits. */
export const CognitoSubjectSchema = z
  .string()
  .max(128)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const PlatformPrincipalSchema = z.object({
  stage: PlatformStageSchema,
  issuer: z.string().url().max(256), sub: CognitoSubjectSchema,
}).strict();
export type PlatformPrincipal = z.infer<typeof PlatformPrincipalSchema>;
export const PlatformGrantSchema = PlatformPrincipalSchema.extend({
  permission: z.literal(PLATFORM_SFE_APPROVAL_MANAGE),
  status: z.enum(["ACTIVE", "REVOKED"]),
  revokedAt: z.string().datetime().nullable(),
  version: z.number().int().positive().safe(),
  updatedAt: z.string().datetime(),
  changedByIamArn: z.string().min(1).max(512),
}).strict().refine(value => value.status === "ACTIVE" ? value.revokedAt === null : value.revokedAt !== null);
export type PlatformGrant = z.infer<typeof PlatformGrantSchema>;
export function platformPrincipalDigest(principal: PlatformPrincipal) {
  return createHash("sha256").update(JSON.stringify([principal.issuer, principal.sub])).digest("hex");
}
/** Only API Gateway's verified authorizer context is accepted; never decode a body/header JWT. */
export function verifiedPlatformPrincipal(event: APIGatewayProxyEventV2WithJWTAuthorizer): PlatformPrincipal {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const parsed = PlatformPrincipalSchema.safeParse({
    stage: process.env.STAGE, issuer: claims?.iss, sub: claims?.sub,
  });
  const trustedIssuer = process.env.PLATFORM_COGNITO_ISSUER;
  if (!parsed.success || !trustedIssuer || parsed.data.issuer !== trustedIssuer ||
    !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/.test(trustedIssuer))
    throw new AppError(401, "PLATFORM_IDENTITY_REQUIRED");
  return parsed.data;
}
