import { z } from "zod";

const text = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
export const EnrollmentEnvironmentSchema = z.enum(["TEST", "PRODUCTION"]);
const version = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
export const FiscalConnectionFieldsSchema = z
  .object({
    environment: EnrollmentEnvironmentSchema,
    taxpayerIfu: text.optional(),
    nim: text.optional(),
    label: z.string().trim().min(1).max(160),
  })
  .strict();
export const PutOrganizationFiscalConnectionSchema =
  FiscalConnectionFieldsSchema.extend({
    connectionId: z.string().uuid(),
    expectedVersion: version,
    commandId: z.string().uuid(),
  }).strict();
export const FiscalCredentialCommandSchema = z
  .object({
    environment: EnrollmentEnvironmentSchema,
    connectionId: z.string().uuid(),
    expectedVersion: version,
    commandId: z.string().uuid(),
  })
  .strict();
/** Only syntactic JWT admission. This does not verify a signature, taxpayer or provider access. */
export const SubmitFiscalCredentialSchema =
  FiscalCredentialCommandSchema.extend({
    token: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      .refine((value) => new TextEncoder().encode(value).length <= 4096),
  }).strict();
export const OrganizationFiscalConnectionSchema =
  FiscalConnectionFieldsSchema.extend({
    connectionId: z.string().uuid(),
    version: z.number().int().positive().safe(),
    credentialStatus: z.enum(["ABSENT", "STORED_UNVERIFIED", "REVOKED"]),
    updatedAt: z.string().datetime(),
  }).strict();
export const OrganizationFiscalSettingsSchema = z
  .object({
    environment: EnrollmentEnvironmentSchema,
    connections: z.array(OrganizationFiscalConnectionSchema).max(50),
    nextCursor: z.string().optional(),
    canManage: z.boolean(),
    readiness: z
      .object({
        state: z.enum(["NOT_CONFIGURED", "INCOMPLETE", "PENDING_VERIFICATION"]),
        providerAuthentication: z.literal("UNVERIFIED"),
        taxpayerIdentity: z.literal("UNVERIFIED"),
        sellerAuthority: z.literal("UNVERIFIED"),
        timezoneAuthority: z.literal("UNVERIFIED"),
        establishmentAssociation: z.literal("UNVERIFIED"),
        productionEligible: z.literal(false),
        issuanceEligible: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type OrganizationFiscalConnection = z.infer<
  typeof OrganizationFiscalConnectionSchema
>;
export type OrganizationFiscalSettings = z.infer<
  typeof OrganizationFiscalSettingsSchema
>;
