import { z } from "zod";

const ref = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime({ precision: 3 });
import { LegalSellerAuthoritySchema } from "../shared/legal-identity-authority";
export {
  AuthorityArtifactSchema,
  LegalSellerAuthoritySchema,
} from "../shared/legal-identity-authority";
export type { LegalSellerAuthority } from "../shared/legal-identity-authority";
export const SalesTimezoneAuthoritySchema = z
  .object({
    orgId: ref,
    reference: z
      .string()
      .regex(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      ),
    version: ref,
    timezone: z.string().min(1).max(100),
    tzdbVersion: ref,
    tzdbArtifactDigest: digest,
    acceptedIdentifierArtifactDigest: digest,
    approvalReference: ref,
  })
  .strict();
export const SalesCalculationBindingSchema = z
  .object({
    policyId: ref,
    policyVersion: ref,
    definitionBytesDigest: digest,
    currencyRegistryId: ref,
    currencyRegistryVersion: ref,
    currencyRegistryDigest: digest,
    calculationDefinitionFingerprint: digest,
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    minorUnitScale: z.number().int().min(0).max(4),
    approvalReference: ref,
  })
  .strict();
export const SalesIssuanceAuthoritySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    orgId: ref,
    documentType: z.enum(["INVOICE", "CREDIT_NOTE"]),
    documentId: ref,
    issuedSourceVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    issuedAt: time,
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    issuanceEventReference: ref,
    sellerAuthority: LegalSellerAuthoritySchema,
    timezoneAuthority: SalesTimezoneAuthoritySchema,
    calculationBinding: SalesCalculationBindingSchema,
    capturedAt: time,
    originalSellerEvidenceReference: ref.optional(),
    originalCalculationBindingReference: ref.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.sellerAuthority.orgId !== v.orgId ||
      v.timezoneAuthority.orgId !== v.orgId ||
      v.capturedAt !== v.issuedAt ||
      (v.documentType === "CREDIT_NOTE"
        ? !v.originalSellerEvidenceReference ||
          !v.originalCalculationBindingReference
        : !!v.originalSellerEvidenceReference ||
          !!v.originalCalculationBindingReference)
    )
      c.addIssue({
        code: "custom",
        message: "Invalid authority publication binding",
      });
  });
/** Backend source metadata. Public SALES handlers explicitly omit these fields. */
export const salesAuthorityFields = {
  calculationBinding: SalesCalculationBindingSchema.optional(),
  issuanceAuthoritySnapshot: SalesIssuanceAuthoritySnapshotSchema.optional(),
  issuanceAuthorityDigest: digest.optional(),
};
export type SalesCalculationBinding = z.infer<
  typeof SalesCalculationBindingSchema
>;
export type SalesTimezoneAuthority = z.infer<
  typeof SalesTimezoneAuthoritySchema
>;
export type SalesIssuanceAuthoritySnapshot = z.infer<
  typeof SalesIssuanceAuthoritySnapshotSchema
>;
