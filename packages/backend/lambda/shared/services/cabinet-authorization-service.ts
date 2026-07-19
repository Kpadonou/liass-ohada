import type { CabinetRole } from "@liass-ohada/shared";
import { AppError } from "../app-error";
import {
  CabinetMemberRecord,
  CabinetTeamRepository,
} from "../repositories/cabinet-team-repository";

export interface CabinetRequestContext {
  orgId: string;
  userId: string;
  cabinetId?: string;
  workspaceType?: "COMPANY" | "ACCOUNTING_FIRM";
  cabinetRole?: CabinetRole;
}

export interface AuthorizedCabinetContext {
  cabinetOrgId: string;
  cabinetId: string;
  caller: CabinetMemberRecord;
}

export class CabinetAuthorizationService {
  static async requireActiveMembership(
    context: CabinetRequestContext,
  ): Promise<AuthorizedCabinetContext> {
    if (context.workspaceType !== "ACCOUNTING_FIRM" || !context.cabinetId) {
      throw new AppError(403, "CABINET_WORKSPACE_REQUIRED");
    }
    const member = await CabinetTeamRepository.getMember(
      context.orgId,
      context.userId,
    );
    if (
      !member ||
      member.status !== "ACTIVE" ||
      member.workspaceType !== "ACCOUNTING_FIRM" ||
      member.cabinetId !== context.cabinetId
    ) {
      throw new AppError(403, "CABINET_MEMBER_NOT_ACTIVE");
    }
    if (!member.cabinetRole) {
      throw new AppError(403, "CABINET_MEMBER_ROLE_REQUIRED");
    }
    return {
      cabinetOrgId: context.orgId,
      cabinetId: context.cabinetId,
      caller: member,
    };
  }

  static async requireAdmin(
    context: CabinetRequestContext,
  ): Promise<AuthorizedCabinetContext> {
    const authorized = await this.requireActiveMembership(context);
    if (authorized.caller.cabinetRole !== "CABINET_ADMIN") {
      throw new AppError(403, "CABINET_MEMBER_ROLE_FORBIDDEN");
    }
    return authorized;
  }

  static async requireTeamVisibility(
    context: CabinetRequestContext,
  ): Promise<AuthorizedCabinetContext> {
    const authorized = await this.requireActiveMembership(context);
    if (
      authorized.caller.cabinetRole !== "CABINET_ADMIN" &&
      authorized.caller.cabinetRole !== "SUPERVISOR"
    ) {
      throw new AppError(403, "CABINET_MEMBER_ROLE_FORBIDDEN");
    }
    return authorized;
  }

  static async requireSelfOrAdmin(
    context: CabinetRequestContext,
    targetUserId: string,
  ): Promise<AuthorizedCabinetContext> {
    const authorized = await this.requireActiveMembership(context);
    if (
      authorized.caller.userId !== targetUserId &&
      authorized.caller.cabinetRole !== "CABINET_ADMIN"
    ) {
      throw new AppError(403, "CABINET_MEMBER_ROLE_FORBIDDEN");
    }
    return authorized;
  }

  static async assertNotLastActiveAdmin(
    cabinetOrgId: string,
    member: CabinetMemberRecord,
  ): Promise<void> {
    if (
      member.cabinetRole !== "CABINET_ADMIN" ||
      member.status !== "ACTIVE"
    ) {
      return;
    }
    const members = await CabinetTeamRepository.listAllMembers(cabinetOrgId);
    const activeAdmins = members.filter(
      (candidate) =>
        candidate.status === "ACTIVE" &&
        candidate.cabinetRole === "CABINET_ADMIN",
    );
    if (activeAdmins.length <= 1) {
      throw new AppError(409, "CABINET_LAST_ADMIN_REQUIRED");
    }
  }
}
