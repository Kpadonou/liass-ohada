import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  AcceptCabinetInvitationResponseSchema,
  CabinetInvitationSchema,
  CreateCabinetInvitationRequest,
  CreateCabinetInvitationResponseSchema,
  ListCabinetInvitationsRequest,
  ListCabinetInvitationsResponseSchema,
  ResendCabinetInvitationResponseSchema,
} from "@liass-ohada/shared";
import { createHash, randomBytes, randomUUID } from "crypto";
import { AppError } from "../app-error";
import { UserProfileRepository } from "../repositories/user-profile-repository";
import {
  CabinetInvitationRecord,
  CabinetTeamRepository,
} from "../repositories/cabinet-team-repository";
import {
  CabinetAuthorizationService,
  CabinetRequestContext,
} from "./cabinet-authorization-service";
import { UserProfileService } from "./user-profile-service";
import { CabinetTeamConfig } from "./cabinet-team-config";
import { assertAssignableDossiers } from "./cabinet-team-service";

export interface InvitationAcceptanceIdentity {
  userId: string;
  email?: unknown;
  emailVerified?: unknown;
  displayName?: unknown;
  givenName?: unknown;
  familyName?: unknown;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashToken(rawToken) };
}

function expirationFrom(now: Date): string {
  return new Date(
    now.getTime() + CabinetTeamConfig.invitationValidityMs(),
  ).toISOString();
}

function invitationDto(invitation: CabinetInvitationRecord) {
  return CabinetInvitationSchema.parse({
    invitationId: invitation.invitationId,
    email: invitation.displayEmail,
    role: invitation.role,
    status: invitation.status,
    invitedBy: invitation.invitedBy,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    acceptedByUserId: invitation.acceptedByUserId,
    cancelledAt: invitation.cancelledAt,
    cancelledBy: invitation.cancelledBy,
    initialDossierOrgIds: invitation.initialDossierOrgIds,
  });
}

function statusError(invitation: CabinetInvitationRecord): AppError {
  if (invitation.status === "ACCEPTED") {
    return new AppError(409, "CABINET_INVITATION_ALREADY_ACCEPTED");
  }
  if (invitation.status === "CANCELLED") {
    return new AppError(409, "CABINET_INVITATION_CANCELLED");
  }
  if (invitation.status === "EXPIRED") {
    return new AppError(409, "CABINET_INVITATION_EXPIRED");
  }
  return new AppError(409, "CABINET_INVITATION_NOT_FOUND");
}

function responseWithOptionalToken(
  invitation: CabinetInvitationRecord,
  rawToken: string,
) {
  return {
    invitation: invitationDto(invitation),
    invitationToken: CabinetTeamConfig.exposeInvitationToken()
      ? rawToken
      : undefined,
  };
}

async function resolvePendingLock(
  cabinetOrgId: string,
  normalizedEmail: string,
  now: string,
): Promise<void> {
  const lock = await CabinetTeamRepository.getInvitationEmailLock(
    cabinetOrgId,
    normalizedEmail,
  );
  if (!lock) return;
  const invitation = await CabinetTeamRepository.getInvitation(
    cabinetOrgId,
    lock.invitationId,
  );
  if (!invitation) {
    try {
      await CabinetTeamRepository.deleteStaleInvitationEmailLock({
        cabinetOrgId,
        normalizedEmail,
        invitationId: lock.invitationId,
      });
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
    return;
  }
  if (
    invitation.status === "PENDING" &&
    new Date(invitation.expiresAt).getTime() > new Date(now).getTime()
  ) {
    throw new AppError(409, "CABINET_INVITATION_ALREADY_PENDING");
  }
  if (invitation.status === "PENDING") {
    try {
      await CabinetTeamRepository.expireInvitation({ invitation, now });
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(409, "CABINET_INVITATION_ALREADY_PENDING");
      }
      throw error;
    }
    return;
  }
  try {
    await CabinetTeamRepository.deleteStaleInvitationEmailLock({
      cabinetOrgId,
      normalizedEmail,
      invitationId: lock.invitationId,
    });
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
  }
}

export class CabinetInvitationService {
  static async createInvitation(
    context: CabinetRequestContext,
    request: CreateCabinetInvitationRequest,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const normalizedEmail = normalizeEmail(request.email);
    const now = new Date();
    const nowIso = now.toISOString();

    if (request.initialDossierOrgIds.length > 20) {
      throw new AppError(400, "CABINET_INVITATION_INITIAL_ASSIGNMENT_LIMIT");
    }
    await assertAssignableDossiers(
      authorized.cabinetId,
      request.initialDossierOrgIds,
    );
    const existingUser =
      await UserProfileRepository.resolveByEmail(normalizedEmail);
    if (existingUser) {
      const member = await CabinetTeamRepository.getMember(
        authorized.cabinetOrgId,
        existingUser.userId,
      );
      if (member?.status === "ACTIVE") {
        throw new AppError(409, "CABINET_MEMBER_ALREADY_ACTIVE");
      }
    }
    await resolvePendingLock(
      authorized.cabinetOrgId,
      normalizedEmail,
      nowIso,
    );

    const token = newToken();
    const invitation: CabinetInvitationRecord = {
      invitationId: `inv-${randomUUID()}`,
      cabinetOrgId: authorized.cabinetOrgId,
      cabinetId: authorized.cabinetId,
      normalizedEmail,
      displayEmail: normalizedEmail,
      role: request.role,
      status: "PENDING",
      invitedBy: authorized.caller.userId,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: expirationFrom(now),
      tokenHash: token.tokenHash,
      initialDossierOrgIds: request.initialDossierOrgIds,
    };
    try {
      await CabinetTeamRepository.createInvitation({ invitation });
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        await resolvePendingLock(
          authorized.cabinetOrgId,
          normalizedEmail,
          new Date().toISOString(),
        );
        throw new AppError(409, "CABINET_INVITATION_ALREADY_PENDING");
      }
      throw error;
    }
    return CreateCabinetInvitationResponseSchema.parse(
      responseWithOptionalToken(invitation, token.rawToken),
    );
  }

  static async listInvitations(
    context: CabinetRequestContext,
    request: ListCabinetInvitationsRequest,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const page = await CabinetTeamRepository.listInvitations({
      cabinetOrgId: authorized.cabinetOrgId,
      limit: request.limit ?? 50,
      cursor: request.cursor,
      status: request.status,
    });
    return ListCabinetInvitationsResponseSchema.parse({
      invitations: page.items.map(invitationDto),
      nextCursor: page.nextCursor,
    });
  }

  static async cancelInvitation(
    context: CabinetRequestContext,
    invitationId: string,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const invitation = await CabinetTeamRepository.getInvitation(
      authorized.cabinetOrgId,
      invitationId,
    );
    if (!invitation) {
      throw new AppError(404, "CABINET_INVITATION_NOT_FOUND");
    }
    if (invitation.status !== "PENDING") throw statusError(invitation);
    const now = new Date().toISOString();
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      await CabinetTeamRepository.expireInvitation({ invitation, now });
      throw new AppError(409, "CABINET_INVITATION_EXPIRED");
    }
    try {
      await CabinetTeamRepository.cancelInvitation({
        invitation,
        actorUserId: authorized.caller.userId,
        now,
      });
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(409, "CABINET_INVITATION_CANCELLED");
      }
      throw error;
    }
    return {
      invitation: invitationDto({
        ...invitation,
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: authorized.caller.userId,
        updatedAt: now,
      }),
    };
  }

  static async resendInvitation(
    context: CabinetRequestContext,
    invitationId: string,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const invitation = await CabinetTeamRepository.getInvitation(
      authorized.cabinetOrgId,
      invitationId,
    );
    if (!invitation) {
      throw new AppError(404, "CABINET_INVITATION_NOT_FOUND");
    }
    if (invitation.status !== "PENDING") throw statusError(invitation);
    const now = new Date();
    if (new Date(invitation.expiresAt).getTime() <= now.getTime()) {
      await CabinetTeamRepository.expireInvitation({
        invitation,
        now: now.toISOString(),
      });
      throw new AppError(409, "CABINET_INVITATION_EXPIRED");
    }
    const token = newToken();
    const expiresAt = expirationFrom(now);
    try {
      await CabinetTeamRepository.resendInvitation({
        invitation,
        newTokenHash: token.tokenHash,
        expiresAt,
        now: now.toISOString(),
      });
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(409, "CABINET_INVITATION_CANCELLED");
      }
      throw error;
    }
    return ResendCabinetInvitationResponseSchema.parse(
      responseWithOptionalToken(
        {
          ...invitation,
          tokenHash: token.tokenHash,
          expiresAt,
          updatedAt: now.toISOString(),
        },
        token.rawToken,
      ),
    );
  }

  static async acceptInvitation(
    token: string,
    identity: InvitationAcceptanceIdentity,
  ) {
    const tokenHash = hashToken(token);
    const lookup = await CabinetTeamRepository.getInvitationTokenLookup(
      tokenHash,
    );
    if (!lookup) throw new AppError(404, "CABINET_INVITATION_TOKEN_INVALID");
    const invitation = await CabinetTeamRepository.getInvitation(
      lookup.cabinetOrgId,
      lookup.invitationId,
    );
    if (
      !invitation ||
      invitation.tokenHash !== tokenHash ||
      invitation.cabinetId !== lookup.cabinetId ||
      invitation.normalizedEmail !== lookup.normalizedEmail
    ) {
      throw new AppError(404, "CABINET_INVITATION_TOKEN_INVALID");
    }
    if (invitation.status !== "PENDING") throw statusError(invitation);
    const now = new Date();
    if (new Date(invitation.expiresAt).getTime() <= now.getTime()) {
      await CabinetTeamRepository.expireInvitation({
        invitation,
        now: now.toISOString(),
      });
      throw new AppError(409, "CABINET_INVITATION_EXPIRED");
    }
    const emailVerified =
      identity.emailVerified === true || identity.emailVerified === "true";
    if (!emailVerified || typeof identity.email !== "string") {
      throw new AppError(403, "CABINET_INVITATION_EMAIL_MISMATCH");
    }
    const email = normalizeEmail(identity.email);
    if (email !== invitation.normalizedEmail) {
      throw new AppError(403, "CABINET_INVITATION_EMAIL_MISMATCH");
    }
    const organization = await CabinetTeamRepository.getOrganization(
      invitation.cabinetOrgId,
    );
    if (
      !organization ||
      organization.workspaceType !== "ACCOUNTING_FIRM" ||
      organization.status !== "ACTIVE"
    ) {
      throw new AppError(403, "CABINET_WORKSPACE_REQUIRED");
    }
    const existing = await CabinetTeamRepository.getMember(
      invitation.cabinetOrgId,
      identity.userId,
    );
    if (existing?.status === "ACTIVE") {
      throw new AppError(409, "CABINET_MEMBER_ALREADY_ACTIVE");
    }
    if (existing) {
      throw new AppError(409, "CABINET_MEMBER_STATUS_TRANSITION_INVALID");
    }
    const dossiers = await assertAssignableDossiers(
      invitation.cabinetId,
      invitation.initialDossierOrgIds,
    );
    const displayName =
      typeof identity.displayName === "string" && identity.displayName.trim()
        ? identity.displayName.trim()
        : [identity.givenName, identity.familyName]
            .filter(
              (value): value is string =>
                typeof value === "string" && value.trim().length > 0,
            )
            .join(" ") || undefined;
    const profile = await UserProfileService.ensureSynchronized({
      userId: identity.userId,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
      givenName: identity.givenName,
      familyName: identity.familyName,
    });
    try {
      await CabinetTeamRepository.acceptInvitation({
        invitation,
        userId: identity.userId,
        displayName: profile.displayName ?? displayName,
        email,
        organization,
        now: now.toISOString(),
      });
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(409, "CABINET_INVITATION_ALREADY_ACCEPTED");
      }
      throw error;
    }
    return AcceptCabinetInvitationResponseSchema.parse({
      member: {
        userId: identity.userId,
        cabinetRole: invitation.role,
        status: "ACTIVE",
        displayName: profile.displayName ?? displayName,
        email,
        joinedAt: now.toISOString(),
        invitedBy: invitation.invitedBy,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        updatedBy: invitation.invitedBy,
      },
      assignments: invitation.initialDossierOrgIds.map((dossierOrgId) => ({
        userId: identity.userId,
        dossierOrgId,
        dossierDisplayName: dossiers.find(
          (dossier) => dossier.orgId === dossierOrgId,
        )?.displayName,
        assignedBy: invitation.invitedBy,
        assignedAt: now.toISOString(),
      })),
    });
  }
}

export const CabinetInvitationSecurity = { hashToken };
