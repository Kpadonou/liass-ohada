import { z } from "zod";
const ref = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const AuthorityArtifactSchema = z
  .object({
    reference: ref,
    version: ref,
    format: ref,
    bytes: z.string().min(1).max(65536),
    digest,
  })
  .strict();
const identifier = z
  .object({
    scheme: z.string().min(1).max(80),
    issuingCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    value: z.string().min(1).max(100),
  })
  .strict();
export const LegalSellerAuthoritySchema = z
  .object({
    orgId: ref,
    legalEntityReference: ref,
    authorityReference: ref,
    authorityVersion: ref,
    identityReference: z
      .string()
      .regex(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      ),
    identityVersion: ref,
    identityDigest: digest,
    seller: z
      .object({
        name: z.string().min(1).max(160),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        address: z
          .object({
            lines: z.array(z.string().min(1).max(300)).min(1).max(3),
            city: z.string().min(1).max(160).optional(),
            postalCode: z.string().min(1).max(32).optional(),
          })
          .strict()
          .optional(),
        identifiers: z.array(identifier).max(16),
      })
      .strict(),
    acceptanceReference: ref,
    acceptanceVersion: ref,
    subjectBindingState: z.literal("VERIFIED"),
    evidenceReference: ref,
    factStates: z
      .array(
        z
          .object({
            fieldPath: ref,
            state: z.enum(["PRESENT", "VERIFIED", "AUTHORITY_UNKNOWN"]),
            evidenceReference: ref.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();

export type LegalSellerAuthority = z.infer<typeof LegalSellerAuthoritySchema>;
