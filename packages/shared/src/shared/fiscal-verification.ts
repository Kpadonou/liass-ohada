import { z } from "zod";

export const FiscalVerificationStatusSchema = z.enum([
  "VERIFIED_TEST",
  "CREDENTIAL_EXPIRED",
  "AUTHENTICATION_REJECTED",
  "IFU_MISMATCH",
  "EMCF_ASSOCIATION_UNVERIFIED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_RESPONSE_INVALID",
  "VERIFICATION_INCOMPLETE",
  "STALE_CONFIGURATION",
  "VERIFICATION_NOT_ENABLED",
  "CREDENTIAL_CONFIGURATION_INVALID",
]);
export const VerifyFiscalConnectionRequestSchema = z
  .object({
    environment: z.enum(["TEST", "PRODUCTION"]),
    connectionId: z.string().uuid(),
    expectedVersion: z.number().int().positive().safe(),
    commandId: z.string().uuid(),
  })
  .strict();
export const FiscalVerificationChecksSchema = z
  .object({
    credentialStored: z.boolean(),
    technicallyVerified: z.boolean(),
    notExpired: z.boolean().nullable(),
    ifuConsistency: z.enum(["MATCH", "MISMATCH", "UNVERIFIED"]),
    nimCorrespondence: z.enum(["MATCH", "UNVERIFIED"]),
    emcfAssociation: z.literal("UNVERIFIED"),
    legalSellerAuthority: z.enum(["APPROVED", "UNVERIFIED"]),
    timezoneAuthority: z.literal("UNVERIFIED"),
    establishmentBinding: z.literal("UNVERIFIED"),
    sfeApprovalReferences: z.enum(["AVAILABLE", "UNVERIFIED"]),
    sfeVersionApplicability: z.literal("UNVERIFIED"),
    executionAuthorized: z.literal(false),
    issuanceEligible: z.literal(false),
    productionEligible: z.literal(false),
  })
  .strict();
export const FiscalVerificationResultSchema = z
  .object({
    operationId: z.string().uuid(),
    environment: z.enum(["TEST", "PRODUCTION"]),
    configurationVersion: z.number().int().positive().safe(),
    status: FiscalVerificationStatusSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    tokenValidUntil: z.string().datetime({ offset: true }).optional(),
    serverDateTime: z.string().datetime({ offset: true }).optional(),
    providerStatus: z.boolean().optional(),
    reportedDeviceCount: z.number().int().min(0).max(1000).optional(),
    inProgress: z.boolean(),
    applicable: z.boolean(),
    checks: FiscalVerificationChecksSchema,
  })
  .strict();
export const FiscalVerificationSummarySchema = z
  .object({
    latestAttempt: FiscalVerificationResultSchema,
    lastVerified: FiscalVerificationResultSchema.optional(),
  })
  .strict();
export type FiscalVerificationResult = z.infer<
  typeof FiscalVerificationResultSchema
>;
export type FiscalVerificationStatus = z.infer<
  typeof FiscalVerificationStatusSchema
>;
