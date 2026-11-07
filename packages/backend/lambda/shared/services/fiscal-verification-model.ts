import { z } from "zod";
import {
  FiscalVerificationResult,
  FiscalVerificationResultSchema,
  FiscalVerificationStatus,
} from "@liass-ohada/shared/shared";
import type { FiscalConnectionStatusEvidence } from "../../domains/fiscal-compliance/connection-verification";

export const FiscalIdentityBindingSchema = z
  .object({
    reference: z.string().uuid(),
    version: z.string().min(1).max(200),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    selectionVersion: z.number().int().positive().safe(),
  })
  .strict();
export const FiscalVerificationBindingSchema = z
  .object({
    orgId: z.string().min(1).max(200),
    connectionId: z.string().uuid(),
    environment: z.enum(["TEST", "PRODUCTION"]),
    configurationVersion: z.number().int().positive().safe(),
    configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    credentialReference: z.string().nullable(),
    credentialVersion: z.literal(1).nullable(),
    credentialStorageVersion: z.number().int().positive().safe().nullable(),
    identity: FiscalIdentityBindingSchema.nullable(),
  })
  .strict();
export const StoredFiscalVerificationSchema = z
  .object({
    binding: FiscalVerificationBindingSchema,
    result: FiscalVerificationResultSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.result.environment === value.binding.environment &&
      value.result.configurationVersion ===
        value.binding.configurationVersion &&
      (value.result.status !== "VERIFIED_TEST" ||
        (value.binding.environment === "TEST" &&
          !!value.binding.credentialReference &&
          value.binding.credentialVersion === 1 &&
          !!value.binding.credentialStorageVersion &&
          !!value.binding.identity &&
          value.result.checks.technicallyVerified &&
          value.result.checks.notExpired === true &&
          value.result.checks.ifuConsistency === "MATCH" &&
          value.result.checks.nimCorrespondence === "MATCH")),
  );
export const FiscalVerificationStateSchema = z
  .object({
    revision: z.number().int().positive().safe(),
    leaseUntil: z.string().datetime(),
    latest: StoredFiscalVerificationSchema,
    lastVerified: StoredFiscalVerificationSchema.optional(),
  })
  .strict();
export type FiscalVerificationBinding = z.infer<
  typeof FiscalVerificationBindingSchema
>;
export type FiscalVerificationState = z.infer<
  typeof FiscalVerificationStateSchema
>;
export function initialVerification(
  operationId: string,
  binding: FiscalVerificationBinding,
  now: string,
): FiscalVerificationResult {
  return FiscalVerificationResultSchema.parse({
    operationId,
    environment: binding.environment,
    configurationVersion: binding.configurationVersion,
    startedAt: now,
    status: "VERIFICATION_INCOMPLETE",
    inProgress: true,
    applicable: false,
    checks: {
      credentialStored: !!binding.credentialReference,
      technicallyVerified: false,
      notExpired: null,
      ifuConsistency: "UNVERIFIED",
      nimCorrespondence: "UNVERIFIED",
      emcfAssociation: "UNVERIFIED",
      legalSellerAuthority: binding.identity ? "APPROVED" : "UNVERIFIED",
      timezoneAuthority: "UNVERIFIED",
      establishmentBinding: "UNVERIFIED",
      sfeApprovalReferences: "UNVERIFIED",
      sfeVersionApplicability: "UNVERIFIED",
      executionAuthorized: false,
      issuanceEligible: false,
      productionEligible: false,
    },
  });
}
export function verificationOutcome(
  base: FiscalVerificationResult,
  status: FiscalVerificationStatus,
  now: string,
): FiscalVerificationResult {
  return {
    ...base,
    status,
    completedAt: now,
    inProgress: false,
    applicable: status !== "STALE_CONFIGURATION",
  };
}
/** Literal identifier correspondence only. No mapping of e-MCFs to legal establishments is inferred. */
export function evaluateDgiStatus(
  base: FiscalVerificationResult,
  evidence: FiscalConnectionStatusEvidence,
  trustedIfu: string,
  declaredIfu: string | undefined,
  declaredNim: string | undefined,
  now: string,
): FiscalVerificationResult {
  let result = verificationOutcome(base, "VERIFICATION_INCOMPLETE", now);
  if (evidence.status !== undefined) result.providerStatus = evidence.status;
  if (evidence.tokenValid)
    result.tokenValidUntil = new Date(evidence.tokenValid).toISOString();
  if (evidence.serverDateTime)
    result.serverDateTime = new Date(evidence.serverDateTime).toISOString();
  // Bounded evidence admission, not a documented DGI fleet limit; never truncate an observation.
  if (evidence.emcfList && evidence.emcfList.length > 1000)
    return { ...result, status: "PROVIDER_RESPONSE_INVALID" };
  if (evidence.emcfList) result.reportedDeviceCount = evidence.emcfList.length;
  if (evidence.status === false)
    return { ...result, status: "PROVIDER_UNAVAILABLE" };
  if (evidence.status !== true || !evidence.tokenValid) return result;
  result.checks = {
    ...result.checks,
    notExpired:
      Date.parse(evidence.tokenValid) >
      Math.max(Date.parse(now), Date.parse(evidence.serverDateTime ?? now)),
  };
  if (!result.checks.notExpired)
    return { ...result, status: "CREDENTIAL_EXPIRED" };
  if (!evidence.ifu || !declaredIfu) return result;
  result.checks.ifuConsistency =
    evidence.ifu === trustedIfu && declaredIfu === trustedIfu
      ? "MATCH"
      : "MISMATCH";
  if (result.checks.ifuConsistency === "MISMATCH")
    return { ...result, status: "IFU_MISMATCH" };
  result.checks.technicallyVerified = true;
  // Requiring both matching observations is a conservative local qualification, not a claim of DGI scope semantics.
  if (
    !declaredNim ||
    evidence.nim !== declaredNim ||
    evidence.emcfList?.filter((device) => device.nim === declaredNim).length !==
      1
  )
    return { ...result, status: "EMCF_ASSOCIATION_UNVERIFIED" };
  result.checks.nimCorrespondence = "MATCH";
  return { ...result, status: "VERIFIED_TEST" };
}
export function publicVerification(
  stored: z.infer<typeof StoredFiscalVerificationSchema>,
  current: { digest: string; identity: FiscalVerificationBinding["identity"] },
  now: string,
) {
  const identityMatches =
    JSON.stringify(stored.binding.identity) ===
    JSON.stringify(current.identity);
  const applicable =
    stored.binding.configurationDigest === current.digest && identityMatches;
  const result = structuredClone(stored.result);
  result.applicable = applicable;
  if (!applicable && !result.inProgress) result.status = "STALE_CONFIGURATION";
  if (!applicable) result.checks.technicallyVerified = false;
  if (
    result.tokenValidUntil &&
    Date.parse(result.tokenValidUntil) <= Date.parse(now)
  ) {
    result.checks.notExpired = false;
    result.checks.technicallyVerified = false;
    if (applicable && result.status === "VERIFIED_TEST")
      result.status = "CREDENTIAL_EXPIRED";
  }
  return FiscalVerificationResultSchema.parse(result);
}
