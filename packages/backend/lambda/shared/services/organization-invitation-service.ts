import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "crypto";
import {
  AcceptOrganizationInvitationRequestSchema,
  AcceptOrganizationInvitationResponseSchema,
  CreateOrganizationInvitationRequestSchema,
  CreateOrganizationInvitationResponseSchema,
  OrganizationInvitationSummarySchema,
} from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import { KeyFactory as K } from "../key-builder";
import {
  OrganizationInvitationRepository as R,
  type OrganizationInvitationEntity,
} from "../repositories/organization-invitation-repository";
import { UserProfileRepository } from "../repositories/user-profile-repository";
import { TenantAccessService } from "./tenant-access-service";
import {
  UserProfileService,
  type AuthenticatedIdentityProjection,
} from "./user-profile-service";
import {
  hashInvitationToken,
  newInvitationToken,
  normalizeInvitationEmail,
} from "./invitation-security";
import { invitationValidityMs } from "./invitation-config";

function retryable(error: unknown) {
  return (
    error instanceof TransactionCanceledException &&
    !error.CancellationReasons?.some(
      (reason) =>
        reason.Code &&
        !["None", "ConditionalCheckFailed", "TransactionConflict"].includes(
          reason.Code,
        ),
    )
  );
}
function summary(invite: OrganizationInvitationEntity) {
  return OrganizationInvitationSummarySchema.parse({
    invitationId: invite.invitationId,
    email: invite.email,
    status:
      invite.status === "PENDING" && Date.parse(invite.expiresAt) <= Date.now()
        ? "EXPIRED"
        : invite.status,
    expiresAt: invite.expiresAt,
  });
}
function result(invite: OrganizationInvitationEntity, rawToken?: string) {
  const expose =
    process.env.NODE_ENV === "development" &&
    process.env.ORGANIZATION_INVITATION_EXPOSE_TOKEN === "true" &&
    !!rawToken;
  return CreateOrganizationInvitationResponseSchema.parse({
    invitation: summary(invite),
    ...(expose ? { invitationToken: rawToken } : {}),
    deliveryMode: expose ? "DEVELOPMENT_TOKEN" : "UNAVAILABLE",
  });
}
export class OrganizationInvitationService {
  static async create(orgId: string, actorUserId: string, input: unknown) {
    const request = CreateOrganizationInvitationRequestSchema.parse(input);
    for (let attempt = 0; attempt < 3; attempt++) {
      const actor = await TenantAccessService.assertUserCanAccessOrg({
        orgId,
        userId: actorUserId,
      });
      if (
        actor.workspaceType !== "COMPANY" ||
        actor.role !== "OWNER" ||
        (actor.accessSource !== undefined && actor.accessSource !== "DIRECT")
      )
        throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
      await R.organization(orgId);
      const replay = await R.replay(
        orgId,
        actorUserId,
        request.clientRequestId,
        request.email,
      );
      if (replay) return result(replay);
      const lookup = await UserProfileRepository.resolveByEmail(request.email);
      if (lookup) {
        const profile = await UserProfileRepository.get(lookup.userId);
        if (
          !profile?.emailVerified ||
          profile.userId !== lookup.userId ||
          profile.normalizedEmail !== request.email
        )
          throw new AppError(409, "USER_PROFILE_EMAIL_CONFLICT");
      }
      if (
        lookup &&
        (lookup.userId === actorUserId ||
          (await R.member(orgId, lookup.userId)))
      )
        throw new AppError(409, "ORGANIZATION_INVITATION_MEMBER_EXISTS");
      const lock = await R.lock(orgId, request.email);
      const previous = lock
        ? await R.invitation(orgId, lock.invitationId)
        : undefined;
      if (lock && (!previous || previous.status !== "PENDING"))
        throw new AppError(409, "ORGANIZATION_INVITATION_CONFLICT");
      if (previous && Date.parse(previous.expiresAt) > Date.now())
        throw new AppError(409, "ORGANIZATION_INVITATION_PENDING");
      const now = new Date(),
        token = newInvitationToken(),
        invitationId = randomUUID();
      const invite: OrganizationInvitationEntity = {
        PK: K.orgKey(orgId),
        SK: K.organizationInvitationSK(invitationId),
        entityType: "ORGANIZATION_INVITATION",
        orgId,
        invitationId,
        email: request.email,
        invitedBy: actorUserId,
        status: "PENDING",
        tokenHash: token.tokenHash,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() +
            invitationValidityMs(
              process.env.ORGANIZATION_INVITATION_VALIDITY_DAYS,
            ),
        ).toISOString(),
      };
      try {
        await R.create(
          invite,
          request.clientRequestId,
          lookup?.userId,
          previous,
        );
        return result(invite, token.rawToken);
      } catch (error) {
        if (!retryable(error)) throw error;
      }
    }
    throw new AppError(409, "ORGANIZATION_INVITATION_CONFLICT");
  }
  static async accept(
    input: unknown,
    identity: AuthenticatedIdentityProjection,
  ) {
    const request = AcceptOrganizationInvitationRequestSchema.parse(input);
    const verified =
      identity.emailVerified === true || identity.emailVerified === "true";
    if (!identity.userId) throw new AppError(401, "ERROR_MISSING_USER_ID");
    if (!verified || typeof identity.email !== "string")
      throw new AppError(403, "ORGANIZATION_INVITATION_EMAIL_MISMATCH");
    const email = normalizeInvitationEmail(identity.email),
      hash = hashInvitationToken(request.token);
    for (let attempt = 0; attempt < 3; attempt++) {
      const lookup = await R.lookup(hash);
      const invite = await R.invitation(lookup.orgId, lookup.invitationId);
      if (!invite || invite.tokenHash !== hash)
        throw new AppError(404, "ORGANIZATION_INVITATION_INVALID");
      if (email !== invite.email)
        throw new AppError(403, "ORGANIZATION_INVITATION_EMAIL_MISMATCH");
      const organization = await R.organization(invite.orgId);
      const existing = await R.member(invite.orgId, identity.userId);
      if (invite.status === "ACCEPTED") {
        if (invite.acceptedByUserId !== identity.userId)
          throw new AppError(403, "ORGANIZATION_INVITATION_INVALID");
        // Replay confirms current membership; never resurrect revoked access.
        if (
          !existing ||
          existing.status !== "ACTIVE" ||
          existing.workspaceType !== "COMPANY" ||
          existing.accessSource !== "DIRECT"
        )
          throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
        return AcceptOrganizationInvitationResponseSchema.parse({
          organizationId: invite.orgId,
          membershipStatus: "ACTIVE",
        });
      }
      if (invite.status !== "PENDING")
        throw new AppError(409, "ORGANIZATION_INVITATION_UNAVAILABLE");
      if (Date.parse(invite.expiresAt) <= Date.now())
        throw new AppError(409, "ORGANIZATION_INVITATION_EXPIRED");
      if (existing)
        throw new AppError(409, "ORGANIZATION_INVITATION_MEMBER_EXISTS");
      const profile = await UserProfileService.ensureSynchronized(identity);
      if (!profile.emailVerified || profile.normalizedEmail !== email)
        throw new AppError(403, "ORGANIZATION_INVITATION_EMAIL_MISMATCH");
      try {
        await R.accept(
          invite,
          identity.userId,
          organization,
          new Date().toISOString(),
        );
        return AcceptOrganizationInvitationResponseSchema.parse({
          organizationId: invite.orgId,
          membershipStatus: "ACTIVE",
        });
      } catch (error) {
        if (!retryable(error)) throw error;
      }
    }
    throw new AppError(409, "ORGANIZATION_INVITATION_CONFLICT");
  }
}
