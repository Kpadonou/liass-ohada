import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  CabinetMemberSchema,
  GetCabinetMemberResponseSchema,
  ListCabinetDossierMembersResponseSchema,
  ListCabinetMemberAssignmentsResponseSchema,
  ListCabinetMembersRequest,
  ListCabinetMembersResponseSchema,
  ReplaceCabinetMemberAssignmentsRequest,
  UpdateCabinetMemberRoleRequest,
  UpdateCabinetMemberStatusRequest,
} from "@liass-ohada/shared";
import { AppError } from "../app-error";
import {
  CabinetDossierAssignmentRecord,
  CabinetMemberRecord,
  CabinetTeamRepository,
} from "../repositories/cabinet-team-repository";
import {
  CabinetAuthorizationService,
  CabinetRequestContext,
} from "./cabinet-authorization-service";

function memberDto(member: CabinetMemberRecord) {
  if (!member.cabinetRole) {
    throw new AppError(409, "CABINET_MEMBER_ROLE_REQUIRED");
  }
  return CabinetMemberSchema.parse({
    userId: member.userId,
    cabinetRole: member.cabinetRole,
    status: member.status,
    displayName: member.displayName,
    email: member.email,
    joinedAt: member.joinedAt,
    invitedBy: member.invitedBy,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    updatedBy: member.updatedBy,
  });
}

function memberSummaryDto(member: CabinetMemberRecord) {
  const value = memberDto(member);
  return {
    userId: value.userId,
    cabinetRole: value.cabinetRole,
    status: value.status,
    displayName: value.displayName,
    email: value.email,
    joinedAt: value.joinedAt,
    updatedAt: value.updatedAt,
  };
}

function assignmentDto(
  assignment: CabinetDossierAssignmentRecord,
  displayName?: string,
) {
  return {
    userId: assignment.userId,
    dossierOrgId: assignment.dossierOrgId,
    dossierDisplayName: displayName,
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.assignedAt,
  };
}

async function assertAssignableDossiers(
  cabinetId: string,
  dossierOrgIds: string[],
) {
  const dossiers = await CabinetTeamRepository.getDossiers(
    cabinetId,
    dossierOrgIds,
  );
  if (dossiers.length !== dossierOrgIds.length) {
    throw new AppError(404, "CABINET_DOSSIER_NOT_OWNED");
  }
  for (const dossier of dossiers) {
    if (dossier.cabinetId !== cabinetId || dossier.relationship !== "CLIENT") {
      throw new AppError(404, "CABINET_DOSSIER_NOT_OWNED");
    }
    if (dossier.status !== "ACTIVE") {
      throw new AppError(409, "CABINET_DOSSIER_INACTIVE");
    }
  }
  return dossiers;
}

export class CabinetTeamService {
  static async listMembers(
    context: CabinetRequestContext,
    request: ListCabinetMembersRequest,
  ) {
    const authorized =
      await CabinetAuthorizationService.requireTeamVisibility(context);
    const supervisor = authorized.caller.cabinetRole === "SUPERVISOR";
    if (supervisor && request.status && request.status !== "ACTIVE") {
      throw new AppError(403, "CABINET_MEMBER_ROLE_FORBIDDEN");
    }
    const page = await CabinetTeamRepository.listMembers({
      cabinetOrgId: authorized.cabinetOrgId,
      limit: request.limit ?? 50,
      cursor: request.cursor,
      role: request.role,
      status: supervisor ? "ACTIVE" : request.status,
    });
    return ListCabinetMembersResponseSchema.parse({
      members: page.items.map(memberSummaryDto),
      nextCursor: page.nextCursor,
    });
  }

  static async getMember(
    context: CabinetRequestContext,
    targetUserId: string,
  ) {
    const authorized = await CabinetAuthorizationService.requireSelfOrAdmin(
      context,
      targetUserId,
    );
    const member = await CabinetTeamRepository.getMember(
      authorized.cabinetOrgId,
      targetUserId,
    );
    if (!member) throw new AppError(404, "CABINET_MEMBER_NOT_FOUND");
    return GetCabinetMemberResponseSchema.parse({ member: memberDto(member) });
  }

  static async updateMemberRole(
    context: CabinetRequestContext,
    targetUserId: string,
    request: UpdateCabinetMemberRoleRequest,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const member = await CabinetTeamRepository.getMember(
      authorized.cabinetOrgId,
      targetUserId,
    );
    if (!member) throw new AppError(404, "CABINET_MEMBER_NOT_FOUND");
    if (!member.cabinetRole) {
      throw new AppError(409, "CABINET_MEMBER_ROLE_REQUIRED");
    }
    if (member.status === "REVOKED") {
      throw new AppError(409, "CABINET_MEMBER_REVOKED");
    }
    if (member.cabinetRole === request.role) {
      throw new AppError(409, "CABINET_MEMBER_ROLE_UNCHANGED");
    }
    if (member.cabinetRole === "CABINET_ADMIN") {
      await CabinetAuthorizationService.assertNotLastActiveAdmin(
        authorized.cabinetOrgId,
        member,
      );
    }
    try {
      const updated = await CabinetTeamRepository.updateMemberRole({
        cabinetOrgId: authorized.cabinetOrgId,
        userId: targetUserId,
        currentRole: member.cabinetRole,
        role: request.role,
        actorUserId: authorized.caller.userId,
        now: new Date().toISOString(),
      });
      if (!updated) throw new AppError(409, "CABINET_MEMBER_NOT_FOUND");
      return GetCabinetMemberResponseSchema.parse({ member: memberDto(updated) });
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new AppError(409, "CABINET_MEMBER_STATUS_TRANSITION_INVALID");
      }
      throw error;
    }
  }

  static async updateMemberStatus(
    context: CabinetRequestContext,
    targetUserId: string,
    request: UpdateCabinetMemberStatusRequest,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const member = await CabinetTeamRepository.getMember(
      authorized.cabinetOrgId,
      targetUserId,
    );
    if (!member) throw new AppError(404, "CABINET_MEMBER_NOT_FOUND");
    if (!member.cabinetRole) {
      throw new AppError(409, "CABINET_MEMBER_ROLE_REQUIRED");
    }
    const allowedTransitions: Record<string, string[]> = {
      ACTIVE: ["SUSPENDED", "REVOKED"],
      SUSPENDED: ["ACTIVE", "REVOKED"],
      REVOKED: [],
    };
    if (!allowedTransitions[member.status]?.includes(request.status)) {
      throw new AppError(409, "CABINET_MEMBER_STATUS_TRANSITION_INVALID");
    }
    if (request.status !== "ACTIVE") {
      await CabinetAuthorizationService.assertNotLastActiveAdmin(
        authorized.cabinetOrgId,
        member,
      );
    }
    try {
      const updated = await CabinetTeamRepository.updateMemberStatus({
        cabinetOrgId: authorized.cabinetOrgId,
        userId: targetUserId,
        currentStatus: member.status,
        status: request.status,
        actorUserId: authorized.caller.userId,
        now: new Date().toISOString(),
      });
      if (!updated) throw new AppError(409, "CABINET_MEMBER_NOT_FOUND");
      return GetCabinetMemberResponseSchema.parse({ member: memberDto(updated) });
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new AppError(409, "CABINET_MEMBER_STATUS_TRANSITION_INVALID");
      }
      throw error;
    }
  }

  static async listMemberAssignments(
    context: CabinetRequestContext,
    targetUserId: string,
  ) {
    const authorized = await CabinetAuthorizationService.requireSelfOrAdmin(
      context,
      targetUserId,
    );
    const member = await CabinetTeamRepository.getMember(
      authorized.cabinetOrgId,
      targetUserId,
    );
    if (!member) throw new AppError(404, "CABINET_MEMBER_NOT_FOUND");
    const assignments = await CabinetTeamRepository.listMemberAssignments(
      authorized.cabinetOrgId,
      targetUserId,
    );
    const dossiers = await CabinetTeamRepository.getDossiers(
      authorized.cabinetId,
      assignments.map((assignment) => assignment.dossierOrgId),
    );
    const names = new Map(
      dossiers.map((dossier) => [dossier.orgId, dossier.displayName]),
    );
    return ListCabinetMemberAssignmentsResponseSchema.parse({
      assignments: assignments
        .filter((assignment) => names.has(assignment.dossierOrgId))
        .map((assignment) =>
          assignmentDto(assignment, names.get(assignment.dossierOrgId)),
        ),
    });
  }

  static async replaceMemberAssignments(
    context: CabinetRequestContext,
    targetUserId: string,
    request: ReplaceCabinetMemberAssignmentsRequest,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    const member = await CabinetTeamRepository.getMember(
      authorized.cabinetOrgId,
      targetUserId,
    );
    if (!member) throw new AppError(404, "CABINET_MEMBER_NOT_FOUND");
    if (member.status === "REVOKED") {
      throw new AppError(409, "CABINET_MEMBER_REVOKED");
    }
    const dossiers = await assertAssignableDossiers(
      authorized.cabinetId,
      request.dossierOrgIds,
    );
    const current = await CabinetTeamRepository.listMemberAssignments(
      authorized.cabinetOrgId,
      targetUserId,
    );
    const currentIds = new Set(current.map((item) => item.dossierOrgId));
    const requestedIds = new Set(request.dossierOrgIds);
    const additions = request.dossierOrgIds.filter((id) => !currentIds.has(id));
    const removals = [...currentIds].filter((id) => !requestedIds.has(id));
    await CabinetTeamRepository.replaceAssignments({
      cabinetOrgId: authorized.cabinetOrgId,
      userId: targetUserId,
      additions,
      removals,
      actorUserId: authorized.caller.userId,
      now: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    const currentById = new Map(current.map((item) => [item.dossierOrgId, item]));
    const dossierNames = new Map(
      dossiers.map((dossier) => [dossier.orgId, dossier.displayName]),
    );
    return ListCabinetMemberAssignmentsResponseSchema.parse({
      assignments: request.dossierOrgIds.map((dossierOrgId) => {
        const existing = currentById.get(dossierOrgId);
        return assignmentDto(
          existing ?? {
            cabinetOrgId: authorized.cabinetOrgId,
            userId: targetUserId,
            dossierOrgId,
            assignedBy: authorized.caller.userId,
            assignedAt: now,
          },
          dossierNames.get(dossierOrgId),
        );
      }),
    });
  }

  static async listDossierMembers(
    context: CabinetRequestContext,
    dossierOrgId: string,
  ) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    await assertAssignableDossiers(authorized.cabinetId, [dossierOrgId]);
    const assignments = await CabinetTeamRepository.listDossierAssignments(
      authorized.cabinetOrgId,
      dossierOrgId,
    );
    const members = await CabinetTeamRepository.batchGetMembers(
      authorized.cabinetOrgId,
      assignments.map((assignment) => assignment.userId),
    );
    return ListCabinetDossierMembersResponseSchema.parse({
      members: members.map(memberSummaryDto),
    });
  }
}

export { assertAssignableDossiers };
