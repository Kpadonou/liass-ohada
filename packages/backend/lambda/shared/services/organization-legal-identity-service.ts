import { z } from "zod";
import { randomUUID } from 'node:crypto';
import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { OrganizationLegalAddressSaveSchema } from '@liass-ohada/shared/shared';
import { config, dynamoClient } from '../dynamo-client';
import { OrganizationFiscalRepository as Access } from '../repositories/organization-fiscal-repository';
import { hash, admission } from '../authority/integrity';
import {
  AuthorityArtifactSchema,
  LegalSellerAuthoritySchema,
} from "@liass-ohada/shared/shared";
import { KeyFactory } from "../key-builder";
import { AppError } from "../app-error";
import { RevisionStore } from "../authority/revision-store";
import { assertArtifact, canonical, clean } from "../authority/integrity";
import { requireLegalReviewer } from "../authorization/legal-review";
import type { PlatformPrincipal } from "../authorization/platform-admin";

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
const attestationSchema = z.object({
  actorUserId: z.string().min(1).max(200),
  orgId: z.string().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }),
  declaration: z.literal('ORGANIZATION_LEGAL_ADDRESS_ATTESTATION_V1'),
  previousRevisionId: z.string().uuid(),
  previousSelectionVersion: z.number().int().positive().safe(),
  changedValues: z.object({
    address: LegalSellerAuthoritySchema.shape.seller.shape.address.unwrap(),
  }).strict(),
}).strict();
function validateFacts(v: z.infer<typeof revisionSchema>) {
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
      ? Object.entries(o).flatMap(([k, value]) => leaves(value, p ? `${p}.${k}` : k))
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
    if (f.state === "ORGANIZATION_ATTESTED" &&
      (f.evidenceReference || !f.fieldPath.startsWith('address.')))
      throw new AppError(422, "AUTHORITY_ATTESTATION_INVALID");
  }
}
function validateArtifacts(v: z.infer<typeof revisionSchema>) {
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
}
function validateReviewed(input: unknown, orgId: string) {
  const v = revisionSchema.parse(input);
  if (
    v.authorityReference !== "PLATFORM_LEGAL_IDENTITY_REVIEW" ||
    v.authorityVersion !== "1"
  )
    throw new AppError(409, "AUTHORITY_UNAVAILABLE");
  if (v.orgId !== orgId) throw new AppError(409, "AUTHORITY_TENANT_MISMATCH");
  validateArtifacts(v);
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
  validateFacts(v);
  return { v, acceptance };
}
function attestedDigest(input: Record<string, unknown>) {
  const { PK: _pk, SK: _sk, identityDigest: _digest, createdAt: _at,
    createdByUserId: _by, revisionId: _id, ...digestInput } = input;
  return hash(canonical(clean(digestInput)));
}
function stableAttestedFacts(v: z.infer<typeof revisionSchema>) {
  const { authorityReference: _authority, identityReference: _reference,
    identityVersion: _version, identityDigest: _digest, seller, factStates,
    ...stable } = v;
  const { address: _address, ...sellerWithoutAddress } = seller;
  return clean({ ...stable, seller: sellerWithoutAddress,
    factStates: factStates.filter((fact) => !fact.fieldPath.startsWith('address.')) });
}
const revisionPayload = (input: Record<string, unknown>) => Object.fromEntries(
  Object.keys(revisionSchema.shape).map((key) => [key, input[key]]),
);
async function validateSelectedRevision(
  orgId: string,
  input: Record<string, unknown>,
  selectionVersion: number,
  visited = new Set<string>(),
): Promise<z.infer<typeof revisionSchema>> {
  if (input.authorityReference === 'PLATFORM_LEGAL_IDENTITY_REVIEW')
    return validateReviewed(revisionPayload(input), orgId).v;
  if (input.authorityReference !== 'ORGANIZATION_ADMIN_ATTESTATION' || input.authorityVersion !== '1')
    throw new AppError(409, 'AUTHORITY_UNAVAILABLE');
  const v = revisionSchema.parse(revisionPayload(input));
  if (v.orgId !== orgId) throw new AppError(409, 'AUTHORITY_TENANT_MISMATCH');
  validateArtifacts(v);
  validateFacts(v);
  const revisionId = z.string().uuid().parse(input.revisionId);
  if (visited.has(revisionId)) throw new AppError(409, 'AUTHORITY_ATTESTATION_INVALID');
  visited.add(revisionId);
  const attestation = attestationSchema.parse(input.attestation);
  if (
    revisionId !== v.identityReference ||
    v.identityVersion !== String(selectionVersion) ||
    input.identityDigest !== attestedDigest(input) ||
    input.createdByUserId !== attestation.actorUserId ||
    input.createdAt !== attestation.occurredAt ||
    attestation.orgId !== orgId ||
    attestation.previousSelectionVersion + 1 !== selectionVersion ||
    canonical(attestation.changedValues.address) !== canonical(v.seller.address)
  )
    throw new AppError(409, 'AUTHORITY_ATTESTATION_INVALID');
  const previousRaw = await store.revision(orgId, attestation.previousRevisionId);
  const previous = await validateSelectedRevision(
    orgId,
    previousRaw,
    attestation.previousSelectionVersion,
    visited,
  );
  if (canonical(stableAttestedFacts(v)) !== canonical(stableAttestedFacts(previous)))
    throw new AppError(409, 'AUTHORITY_ATTESTATION_INVALID');
  const addressValue = (authority: z.infer<typeof revisionSchema>, path: string) => {
    const address = authority.seller.address;
    if (path.startsWith('address.lines.')) return address?.lines[Number(path.slice(14))];
    return path === 'address.city' ? address?.city : address?.postalCode;
  };
  for (const fact of v.factStates.filter(({ fieldPath }) => fieldPath.startsWith('address.'))) {
    const prior = previous.factStates.find(({ fieldPath }) => fieldPath === fact.fieldPath);
    if (fact.state !== 'ORGANIZATION_ATTESTED' && (
      !prior ||
      canonical(fact) !== canonical(prior) ||
      canonical(addressValue(v, fact.fieldPath)) !== canonical(addressValue(previous, fact.fieldPath))
    ))
      throw new AppError(409, 'AUTHORITY_ATTESTATION_INVALID');
  }
  return v;
}
/** Platform-owned reviewed identity boundary. Mutations require an explicit Platform grant;
 * organization ownership alone never permits verification or selection. */
export class OrganizationLegalIdentityService {
  /** A verified connection remains bound to the same seller when later selected
   * revisions only attest address corrections. Every link is validated against
   * its immutable predecessor; a reviewed or seller-critical change stops the walk. */
  static async isAddressOnlySuccessor(orgId: string, prior: {
    reference: string; version: string; digest: string; selectionVersion: number;
  }): Promise<boolean> {
    try {
      const current = await store.current(orgId);
      if (prior.selectionVersion >= current.selectionVersion) return false;
      let raw = current.revision;
      let revision = await validateSelectedRevision(orgId, raw, current.selectionVersion);
      let version = current.selectionVersion;
      while (version > prior.selectionVersion) {
        if (revision.authorityReference !== 'ORGANIZATION_ADMIN_ATTESTATION') return false;
        const attestation = attestationSchema.parse(raw.attestation);
        raw = await store.revision(orgId, attestation.previousRevisionId);
        revision = await validateSelectedRevision(orgId, raw, version - 1);
        version -= 1;
      }
      return revision.identityReference === prior.reference &&
        revision.identityVersion === prior.version && revision.identityDigest === prior.digest;
    } catch { return false; }
  }
  /** Configuration read; fiscal consumers must use the validated authority boundary below. */
  static async readSelectedIdentity(orgId: string) {
    return store.current(orgId);
  }
  static async saveLegalAddress(orgId: string, actor: string, raw: unknown) {
    await Access.authorize(orgId, actor, true, false);
    const input = OrganizationLegalAddressSaveSchema.parse(raw);
    const current = await store.current(orgId);
    if (current.selectionVersion !== input.expectedSelectionVersion)
      throw new AppError(409, 'AUTHORITY_SELECTION_CONFLICT');
    const old = current.revision;
    const seller = LegalSellerAuthoritySchema.shape.seller.parse(old.seller);
    const now = new Date().toISOString(), id = randomUUID();
    const previousStates = z.array(z.object({fieldPath: z.string(),
      state: z.enum(['PRESENT', 'VERIFIED', 'AUTHORITY_UNKNOWN', 'ORGANIZATION_ATTESTED']),
      evidenceReference: z.string().optional()}).strict()).parse(old.factStates);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const oldAddress = seller.address;
    const addressValue = (address: typeof oldAddress, path: string) => {
      if (path.startsWith('address.lines.')) return address?.lines[Number(path.slice(14))];
      return path === 'address.city' ? address?.city : address?.postalCode;
    };
    const addressPaths = [...input.address.lines.map((_, i) => `address.lines.${i}`),
      ...(input.address.city ? ['address.city'] : []), ...(input.address.postalCode ? ['address.postalCode'] : [])];
    const addressFacts = addressPaths.map(fieldPath => {
      const prior = previousStates.find(f => f.fieldPath === fieldPath);
      return prior && same(addressValue(oldAddress, fieldPath), addressValue(input.address, fieldPath))
        ? prior : { fieldPath, state: 'ORGANIZATION_ATTESTED' };
    });
    const attestation = { actorUserId: actor, orgId, occurredAt: now,
      declaration: 'ORGANIZATION_LEGAL_ADDRESS_ATTESTATION_V1',
      previousRevisionId: old.revisionId, previousSelectionVersion: current.selectionVersion,
      changedValues: { address: input.address } };
    const identity: Record<string, unknown> = clean({ ...old, seller: { ...seller, address: input.address },
      identityReference: id, identityVersion: String(current.selectionVersion + 1),
      authorityReference: 'ORGANIZATION_ADMIN_ATTESTATION', authorityVersion: '1',
      factStates: [...previousStates.filter(f => !f.fieldPath.startsWith('address.')), ...addressFacts]
        .sort((a,b) => a.fieldPath.localeCompare(b.fieldPath)), attestation });
    const { PK: _pk, SK: _sk, identityDigest: _digest, createdAt: _at,
      createdByUserId: _by, revisionId: _id, ...digestInput } = identity;
    const identityDigest = hash(canonical(digestInput));
    const revision = { ...identity, PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.organizationLegalIdentityRevisionSK(id), revisionId: id,
      identityDigest, createdAt: now, createdByUserId: actor };
    const version = current.selectionVersion + 1;
    const pointer = { PK: KeyFactory.orgKey(orgId), SK: KeyFactory.organizationLegalIdentityCurrentSK(),
      entityType: 'ORGANIZATION_LEGAL_IDENTITY_CURRENT', orgId, version, status: 'ACTIVE',
      selectedRevisionId: id, identityDigest, legalEntityReference: old.legalEntityReference,
      updatedAt: now, updatedByUserId: actor };
    const history = { ...pointer, SK: KeyFactory.organizationLegalIdentitySelectionSK(version),
      entityType: 'ORGANIZATION_LEGAL_IDENTITY_SELECTION', previousVersion: current.selectionVersion,
      actorUserId: actor, occurredAt: now };
    admission(revision, 131072);
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [Access.membershipCheck(orgId, actor),
        { Put: { TableName: config.TABLE_NAME, Item: marshall(revision), ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: config.TABLE_NAME, Item: marshall(pointer),
          ConditionExpression: '#version = :version AND selectedRevisionId = :id AND identityDigest = :digest',
          ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: marshall({
            ':version': current.selectionVersion, ':id': old.revisionId, ':digest': old.identityDigest }) } },
        { Put: { TableName: config.TABLE_NAME, Item: marshall(history), ConditionExpression: 'attribute_not_exists(PK)' } },
      ] }));
    } catch (e) {
      if ((e as Error).name === 'TransactionCanceledException') throw new AppError(409, 'AUTHORITY_SELECTION_CONFLICT');
      throw e;
    }
    return this.readSelectedIdentity(orgId);
  }
  static async readSelectionVersion(orgId: string) { return store.selectionVersion(orgId); }
  /** Read-only fiscal identity boundary; declared connection IFU is never trusted evidence. */
  static async readFiscalTaxpayerAuthority(orgId: string) {
    const result = await store.current(orgId);
    const v = await validateSelectedRevision(orgId, result.revision, result.selectionVersion);
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
    actorUserId: string | PlatformPrincipal,
    input: unknown,
  ) {
    const grant = await requireLegalReviewer(actorUserId);
    const actor = grant.actor;
    const { v, acceptance } = validateReviewed(input, orgId);
    if (acceptance.reviewedByUserId !== actor)
      throw new AppError(403, "AUTHORITY_REVIEW_ACTOR_MISMATCH");
    await store.create(orgId, v.identityReference, v, actor, [grant.check]);
  }
  static async activate(
    orgId: string,
    actorUserId: string | PlatformPrincipal,
    revisionId: string,
    expectedVersion: number,
  ) {
    const grant = await requireLegalReviewer(actorUserId);
    const actor = grant.actor;
    const r = await store.revision(orgId, revisionId);
    const { v, acceptance } = validateReviewed(
      revisionPayload(r),
      orgId,
    );
    if (acceptance.selectionBaseVersion !== expectedVersion)
      throw new AppError(409, "AUTHORITY_NEW_ACCEPTANCE_REQUIRED");
    await store.select(
      orgId,
      revisionId,
      expectedVersion,
      actor,
      "ACTIVE",
      {
        identityDigest: v.identityDigest,
        acceptanceReference: v.acceptanceReference,
        acceptanceVersion: v.acceptanceVersion,
        legalEntityReference: v.legalEntityReference,
      },
      [grant.check],
    );
  }
  static async disable(
    orgId: string,
    actorUserId: string | PlatformPrincipal,
    revisionId: string,
    expectedVersion: number,
  ) {
    const grant = await requireLegalReviewer(actorUserId);
    const actor = grant.actor;
    const r = await store.revision(orgId, revisionId);
    await store.select(
      orgId,
      revisionId,
      expectedVersion,
      actor,
      "DISABLED",
      {
        identityDigest: r.identityDigest,
        acceptanceReference: r.acceptanceReference,
        acceptanceVersion: r.acceptanceVersion,
        legalEntityReference: r.legalEntityReference,
      },
      [grant.check],
    );
  }
  static async readSellerIssuanceAuthority(orgId: string) {
    const result = await store.current(orgId);
    const v = await validateSelectedRevision(orgId, result.revision, result.selectionVersion);
    const { evidenceArtifacts, ...sellerAuthority } = v;
    return { sellerAuthority, selectionVersion: result.selectionVersion, check: result.check };
  }
}
