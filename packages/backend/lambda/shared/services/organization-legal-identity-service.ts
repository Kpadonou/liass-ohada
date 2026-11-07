import { z } from "zod";
import {
  AuthorityArtifactSchema,
  LegalSellerAuthoritySchema,
} from "@liass-ohada/shared/shared";
import { KeyFactory } from "../key-builder";
import { AppError } from "../app-error";
import { RevisionStore } from "../authority/revision-store";
import { assertArtifact, canonical, clean } from "../authority/integrity";
import { TenantAccessService } from "./tenant-access-service";

const store = new RevisionStore({
  type: "ORGANIZATION_LEGAL_IDENTITY",
  cap: 131072,
  revisionKey: KeyFactory.organizationLegalIdentityRevisionSK,
  currentKey: KeyFactory.organizationLegalIdentityCurrentSK,
  historyKey: KeyFactory.organizationLegalIdentitySelectionSK,
  digestField: "identityDigest",
});
const revisionSchema = LegalSellerAuthoritySchema.extend({
  evidenceArtifacts: z.array(AuthorityArtifactSchema).min(2).max(64),
}).strict();
async function reviewer(orgId: string, actor: string) {
  const a = await TenantAccessService.assertUserCanAccessOrg({
    orgId,
    userId: actor,
  });
  if (
    a.role !== "OWNER" ||
    a.workspaceType !== "COMPANY" ||
    a.accessSource === "CABINET"
  )
    throw new AppError(403, "AUTHORITY_REVIEW_NOT_AUTHORIZED");
}
function validate(input: unknown, orgId: string) {
  const v = revisionSchema.parse(input);
  if (
    v.authorityReference !== "PLATFORM_LEGAL_IDENTITY_REVIEW" ||
    v.authorityVersion !== "1"
  )
    throw new AppError(409, "AUTHORITY_UNAVAILABLE");
  if (v.orgId !== orgId) throw new AppError(409, "AUTHORITY_TENANT_MISMATCH");
  for (const a of v.evidenceArtifacts) {
    if (a.format !== "LIASS-AUTHORITY-JSON-1")
      throw new AppError(422, "AUTHORITY_ARTIFACT_FORMAT_UNSUPPORTED");
    assertArtifact(a);
  }
  if (
    new Set(v.evidenceArtifacts.map((a) => a.reference)).size !==
    v.evidenceArtifacts.length
  )
    throw new AppError(422, "AUTHORITY_DUPLICATE_ARTIFACT");
  const {
    identityDigest,
    acceptanceReference,
    acceptanceVersion,
    evidenceArtifacts,
    ...identity
  } = v;
  const evidence = evidenceArtifacts.find(
    (a) =>
      a.reference === v.identityReference && a.version === v.identityVersion,
  );
  if (
    !evidence ||
    evidence.digest !== identityDigest ||
    evidence.bytes !== canonical(clean(identity))
  )
    throw new AppError(422, "AUTHORITY_IDENTITY_PROOF_MISMATCH");
  const accepted = evidenceArtifacts.find(
    (a) =>
      a.reference === acceptanceReference && a.version === acceptanceVersion,
  );
  if (!accepted) throw new AppError(422, "AUTHORITY_ACCEPTANCE_MISSING");
  const acceptance = z
    .object({
      orgId: z.literal(orgId),
      identityReference: z.literal(v.identityReference),
      identityVersion: z.literal(v.identityVersion),
      identityDigest: z.literal(identityDigest),
      decision: z.literal("ACCEPTED"),
      reviewedByUserId: z.string().min(1).max(200),
      selectionBaseVersion: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER - 1),
    })
    .strict()
    .parse(JSON.parse(accepted.bytes));
  const paths = v.factStates.map((f) => f.fieldPath);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((p, i) => i > 0 && p <= paths[i - 1])
  )
    throw new AppError(422, "AUTHORITY_INVALID_FACT_STATES");
  if (
    !v.factStates.some(
      (f) =>
        f.fieldPath === "name" && f.state === "VERIFIED" && f.evidenceReference,
    )
  )
    throw new AppError(422, "AUTHORITY_NAME_NOT_VERIFIED");
  const leaves = (o: unknown, p = ""): string[] =>
    o !== null && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k))
      : [p];
  const actual = leaves(v.seller);
  if (paths.length !== actual.length || paths.some((p) => !actual.includes(p)))
    throw new AppError(422, "AUTHORITY_INVALID_FACT_STATES");
  for (const f of v.factStates) {
    if (
      f.state === "VERIFIED" &&
      (!f.evidenceReference ||
        !v.evidenceArtifacts.some((a) => a.reference === f.evidenceReference))
    )
      throw new AppError(422, "AUTHORITY_FACT_PROOF_MISSING");
  }
  return { v, acceptance };
}
/** Platform-owned internal boundary. No public review/configuration route or automatic verification. */
export class OrganizationLegalIdentityService {
  /** Read-only fiscal identity boundary; declared connection IFU is never trusted evidence. */
  static async readFiscalTaxpayerAuthority(orgId: string) {
    const result = await store.current(orgId);
    const { v } = validate(Object.fromEntries(
      Object.keys(revisionSchema.shape).map(k => [k, result.revision[k]]),
    ), orgId);
    const identifiers = v.seller.identifiers.map((value, index) => ({ value, index }))
      .filter(({ value }) => value.scheme === "IFU" && value.issuingCountry === "BJ");
    const verified = (path: string) => v.factStates.some(f => f.fieldPath === path && f.state === "VERIFIED" && f.evidenceReference);
    const candidate = identifiers.length === 1 ? identifiers[0] : undefined;
    const ifu = v.seller.country === "BJ" && verified("country") && candidate &&
      ["scheme", "issuingCountry", "value"].every(field => verified(`identifiers.${candidate.index}.${field}`))
      ? candidate.value.value : null;
    return { ifu, binding: { reference: v.identityReference, version: v.identityVersion,
      digest: v.identityDigest, selectionVersion: result.selectionVersion }, check: result.check };
  }
  static async createRevision(
    orgId: string,
    actorUserId: string,
    input: unknown,
  ) {
    await reviewer(orgId, actorUserId);
    const { v, acceptance } = validate(input, orgId);
    if (acceptance.reviewedByUserId !== actorUserId)
      throw new AppError(403, "AUTHORITY_REVIEW_ACTOR_MISMATCH");
    await store.create(orgId, v.identityReference, v, actorUserId);
  }
  static async activate(
    orgId: string,
    actorUserId: string,
    revisionId: string,
    expectedVersion: number,
  ) {
    await reviewer(orgId, actorUserId);
    const r = await store.revision(orgId, revisionId);
    const { v, acceptance } = validate(
      Object.fromEntries(
        Object.keys(revisionSchema.shape).map((k) => [k, r[k]]),
      ),
      orgId,
    );
    if (acceptance.selectionBaseVersion !== expectedVersion)
      throw new AppError(409, "AUTHORITY_NEW_ACCEPTANCE_REQUIRED");
    await store.select(
      orgId,
      revisionId,
      expectedVersion,
      actorUserId,
      "ACTIVE",
      {
        identityDigest: v.identityDigest,
        acceptanceReference: v.acceptanceReference,
        acceptanceVersion: v.acceptanceVersion,
        legalEntityReference: v.legalEntityReference,
      },
    );
  }
  static async disable(
    orgId: string,
    actorUserId: string,
    revisionId: string,
    expectedVersion: number,
  ) {
    await reviewer(orgId, actorUserId);
    const r = await store.revision(orgId, revisionId);
    await store.select(
      orgId,
      revisionId,
      expectedVersion,
      actorUserId,
      "DISABLED",
      {
        identityDigest: r.identityDigest,
        acceptanceReference: r.acceptanceReference,
        acceptanceVersion: r.acceptanceVersion,
        legalEntityReference: r.legalEntityReference,
      },
    );
  }
  static async readSellerIssuanceAuthority(orgId: string) {
    const result = await store.current(orgId);
    const { v } = validate(
      Object.fromEntries(
        Object.keys(revisionSchema.shape).map((k) => [k, result.revision[k]]),
      ),
      orgId,
    );
    const { evidenceArtifacts, ...sellerAuthority } = v;
    return { sellerAuthority, check: result.check };
  }
}
