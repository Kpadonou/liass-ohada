import { z } from "zod";
import { LegalSellerAuthoritySchema } from "@liass-ohada/shared/shared";
import { canonical, clean, hash } from "@/lambda/shared/authority/integrity";

// Immutable publication-time binding; absence of origin is legacy/synthetic, never authentic.
const ref = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive().safe();
export const restaurantIssuanceTimezoneSchema = z
  .object({
    orgId: ref,
    reference: z.string().uuid(),
    version: ref,
    timezone: ref,
    tzdbVersion: z.literal("2026a"),
    tzdbArtifactDigest: digest,
    acceptedIdentifierArtifactDigest: digest,
    configurationDigest: digest,
    approvalReference: ref,
    approvalVersion: ref,
  })
  .strict();
const payloadSchema = z
  .object({
    evidenceOrigin: z.enum(["AUTHENTIC", "SYNTHETIC"]).optional(),
    schemaVersion: z.literal(1),
    captureProtocol: z.literal("RESTAURANTS-FINAL-AUTHORITY-1"),
    orgId: ref,
    outletId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    guestSessionId: z.string().uuid(),
    sourceVersion: version,
    financialRevision: version,
    finalManifestVersion: version,
    event: z.literal("RESTAURANTS_INVOICE_FINAL"),
    issuedAt: z.string().datetime({ offset: true }),
    capturedAt: z.string().datetime({ offset: true }),
    actorUserId: ref,
    commercialRootDigest: digest,
    seller: LegalSellerAuthoritySchema,
    timezone: restaurantIssuanceTimezoneSchema,
    sellerSelectionVersion: version,
    timezoneSelectionVersion: version,
  })
  .strict();
export const restaurantIssuanceProvenanceSchema = payloadSchema.extend({
  bindingDigest: digest,
});
type Payload = z.infer<typeof payloadSchema>;
function validateBinding(payload: Payload) {
  if (
    payload.orgId !== payload.seller.orgId ||
    payload.orgId !== payload.timezone.orgId ||
    payload.issuedAt !== payload.capturedAt ||
    payload.seller.authorityReference !== "PLATFORM_LEGAL_IDENTITY_REVIEW" ||
    payload.seller.authorityVersion !== "1" ||
    !payload.seller.factStates.some(
      (f) =>
        f.fieldPath === "name" && f.state === "VERIFIED" && f.evidenceReference,
    )
  )
    throw Error("RESTAURANT_PROVENANCE_BINDING_INVALID");
}
/** Accepts owner-verified snapshots; does not resolve authority, approve timezone or write data. */
export function bindRestaurantIssuanceProvenance(input: Payload) {
  const payload = payloadSchema.parse(clean(input));
  validateBinding(payload);
  return restaurantIssuanceProvenanceSchema.parse({
    ...payload,
    bindingDigest: hash(canonical(payload)),
  });
}
/** Historical absence is explicit; never hydrate historical facts from current configuration. */
export function verifyRestaurantIssuanceProvenance(
  input: unknown,
  expected: {
    orgId: string;
    outletId: string;
    invoiceId: string;
    guestSessionId: string;
    commercialRootDigest: string;
    issuedAt: string;
  },
) {
  if (input === undefined)
    return {
      verified: false as const,
      reason: "PROVENANCE_UNAVAILABLE" as const,
    };
  const parsed = restaurantIssuanceProvenanceSchema.safeParse(input);
  if (!parsed.success)
    return {
      verified: false as const,
      reason: "PROVENANCE_INTEGRITY" as const,
    };
  try {
    const { bindingDigest, ...payload } = parsed.data;
    validateBinding(payload);
    if (
      hash(canonical(clean(payload))) !== bindingDigest ||
      Object.entries(expected).some(
        ([key, value]) => payload[key as keyof Payload] !== value,
      )
    )
      throw Error();
    return { verified: true as const, evidence: parsed.data };
  } catch {
    return {
      verified: false as const,
      reason: "PROVENANCE_INTEGRITY" as const,
    };
  }
}
