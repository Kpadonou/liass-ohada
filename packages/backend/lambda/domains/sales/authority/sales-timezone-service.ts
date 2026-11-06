import { z } from "zod";
import {
  AuthorityArtifactSchema,
  SalesTimezoneAuthoritySchema,
} from "@liass-ohada/shared/sales";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { RevisionStore } from "@/lambda/shared/authority/revision-store";
import {
  assertArtifact,
  canonical,
  hash,
  clean,
} from "@/lambda/shared/authority/integrity";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  tzdbVersion,
  tzdbDigest,
  identifierBytes,
  identifierDigest,
  tzdbArchiveBase64,
} from "./iana-artifacts";
const store = new RevisionStore({
  type: "SALES_ISSUANCE_TIMEZONE",
  cap: 16384,
  revisionKey: KeyFactory.salesIssuanceTimezoneRevisionSK,
  currentKey: KeyFactory.salesIssuanceTimezoneCurrentSK,
  historyKey: KeyFactory.salesIssuanceTimezoneSelectionSK,
  digestField: "configurationDigest",
});
const schema = SalesTimezoneAuthoritySchema.extend({
  evidenceArtifacts: z.array(AuthorityArtifactSchema).length(2),
}).strict();
export function validateTimezone(input: unknown, orgId: string) {
  const v = schema.parse(input);
  if (v.orgId !== orgId) throw new AppError(409, "AUTHORITY_TENANT_MISMATCH");
  if (
    hash(Buffer.from(tzdbArchiveBase64, "base64")) !== tzdbDigest ||
    hash(identifierBytes) !== identifierDigest ||
    v.tzdbVersion !== tzdbVersion ||
    v.tzdbArtifactDigest !== tzdbDigest ||
    v.acceptedIdentifierArtifactDigest !== identifierDigest ||
    !(JSON.parse(identifierBytes) as string[]).includes(v.timezone)
  )
    throw new AppError(422, "SALES_TIMEZONE_AUTHORITY_INVALID");
  for (const a of v.evidenceArtifacts) {
    if (a.format !== "LIASS-AUTHORITY-JSON-1")
      throw new AppError(422, "AUTHORITY_ARTIFACT_FORMAT_UNSUPPORTED");
    assertArtifact(a);
  }
  const { evidenceArtifacts, ...authority } = v;
  const config = evidenceArtifacts.find(
    (a) => a.reference === v.reference && a.version === v.version,
  );
  const approval = evidenceArtifacts.find(
    (a) => a.reference === v.approvalReference,
  );
  if (
    !config ||
    config.bytes !== canonical(authority) ||
    !approval ||
    config === approval
  )
    throw new AppError(422, "SALES_TIMEZONE_EVIDENCE_MISMATCH");
  z.object({
    orgId: z.literal(orgId),
    reference: z.literal(v.reference),
    version: z.literal(v.version),
    configurationDigest: z.literal(config.digest),
    decision: z.literal("ACCEPTED"),
    reviewedByUserId: z.string().min(1).max(200),
    selectionBaseVersion: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
    .strict()
    .parse(JSON.parse(approval.bytes));
  return {
    v,
    authority,
    configurationDigest: config.digest,
    reviewedByUserId: (
      JSON.parse(approval.bytes) as { reviewedByUserId: string }
    ).reviewedByUserId,
    selectionBaseVersion: (
      JSON.parse(approval.bytes) as { selectionBaseVersion: number }
    ).selectionBaseVersion,
  };
}
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
export class SalesTimezoneService {
  static async createRevision(orgId: string, actor: string, input: unknown) {
    await reviewer(orgId, actor);
    const { v, configurationDigest, reviewedByUserId } = validateTimezone(
      input,
      orgId,
    );
    if (reviewedByUserId !== actor)
      throw new AppError(403, "AUTHORITY_REVIEW_ACTOR_MISMATCH");
    await store.create(
      orgId,
      v.reference,
      { ...clean(v), configurationDigest },
      actor,
    );
  }
  static async activate(
    orgId: string,
    actor: string,
    id: string,
    expectedVersion: number,
  ) {
    await reviewer(orgId, actor);
    const r = await store.revision(orgId, id);
    const { v, configurationDigest, selectionBaseVersion } = validateTimezone(
      Object.fromEntries(Object.keys(schema.shape).map((k) => [k, r[k]])),
      orgId,
    );
    if (selectionBaseVersion !== expectedVersion)
      throw new AppError(409, "AUTHORITY_NEW_ACCEPTANCE_REQUIRED");
    await store.select(orgId, id, expectedVersion, actor, "ACTIVE", {
      configurationDigest,
      approvalReference: v.approvalReference,
    });
  }
  static async disable(
    orgId: string,
    actor: string,
    id: string,
    expectedVersion: number,
  ) {
    await reviewer(orgId, actor);
    const r = await store.revision(orgId, id);
    await store.select(orgId, id, expectedVersion, actor, "DISABLED", {
      configurationDigest: r.configurationDigest,
      approvalReference: r.approvalReference,
    });
  }
  static async readIssuanceAuthority(orgId: string) {
    const r = await store.current(orgId);
    const { authority } = validateTimezone(
      Object.fromEntries(
        Object.keys(schema.shape).map((k) => [k, r.revision[k]]),
      ),
      orgId,
    );
    return { timezoneAuthority: authority, check: r.check };
  }
}
