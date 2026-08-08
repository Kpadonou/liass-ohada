import type { AccountingAccessMode, CabinetRole } from "@liass-ohada/shared";
import type { AccountingPermission } from "../authorization/accounting-permission";
import type { DomainPermission } from "../authorization/domain-permission";
import { AppError } from "../app-error";
import { AccountingAuthorizationRepository } from "../repositories/accounting-authorization-repository";
import { CabinetTeamRepository } from "../repositories/cabinet-team-repository";
import { TenantAccessService } from "./tenant-access-service";
import { DomainAuthorizationService } from "./domain-authorization-service";

export interface AuthorizedAccountingContext {
  accountingFramework?: string;
  accessMode: AccountingAccessMode;
  accessSource: "CABINET" | "DIRECT";
  cabinetId?: string;
  cabinetOrgId?: string;
  cabinetRole?: CabinetRole;
  orgId: string;
  permissions?: readonly DomainPermission[];
  role?: string;
  workspaceOrgId: string;
}

function accessModeForRole(role: CabinetRole): AccountingAccessMode {
  return role === "READER" ? "READ_ONLY" : "READ_WRITE";
}

export class AccountingAuthorizationService {
  static async resolveAccess(input: {
    orgId: string;
    userId: string;
    workspaceOrgId?: string;
  }): Promise<AuthorizedAccountingContext> {
    const workspaceOrgId = input.workspaceOrgId?.trim() || input.orgId;

    if (workspaceOrgId === input.orgId) {
      const directAccess = await TenantAccessService.assertUserCanAccessOrg({
        orgId: input.orgId,
        userId: input.userId,
      });
      if (directAccess.workspaceType !== "COMPANY") {
        throw new AppError(403, "ERROR_ACCOUNTING_DOSSIER_REQUIRED");
      }
      if (directAccess.accessSource === "CABINET") {
        throw new AppError(403, "ACCOUNTING_ACCESS_CONTEXT_INVALID");
      }
      return {
        accountingFramework: directAccess.accountingFramework,
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        cabinetId: directAccess.cabinetId,
        orgId: input.orgId,
        permissions:
          DomainAuthorizationService.permissionsForAccessMode("READ_WRITE"),
        role: directAccess.role,
        workspaceOrgId,
      };
    }

    const cabinetAccess = await CabinetTeamRepository.getMember(
      workspaceOrgId,
      input.userId,
    );
    if (!cabinetAccess || cabinetAccess.status !== "ACTIVE") {
      throw new AppError(403, "CABINET_MEMBER_NOT_ACTIVE");
    }
    if (
      cabinetAccess.workspaceType !== "ACCOUNTING_FIRM" ||
      !cabinetAccess.cabinetId
    ) {
      throw new AppError(403, "ACCOUNTING_ACCESS_CONTEXT_INVALID");
    }
    if (!cabinetAccess.cabinetRole) {
      throw new AppError(403, "CABINET_MEMBER_ROLE_REQUIRED");
    }

    const role = cabinetAccess.cabinetRole;
    const administrator = role === "CABINET_ADMIN";
    const snapshot = await AccountingAuthorizationRepository.getSnapshot({
      cabinetId: cabinetAccess.cabinetId,
      cabinetOrgId: workspaceOrgId,
      dossierOrgId: input.orgId,
      includeAssignment: !administrator,
      userId: input.userId,
    });

    if (
      !snapshot.dossier ||
      snapshot.dossier.cabinetId !== cabinetAccess.cabinetId ||
      snapshot.dossier.orgId !== input.orgId ||
      snapshot.dossier.relationship !== "CLIENT"
    ) {
      throw new AppError(403, "CABINET_DOSSIER_NOT_OWNED");
    }
    if (
      snapshot.dossier.status !== "ACTIVE" ||
      !snapshot.organization ||
      snapshot.organization.orgId !== input.orgId ||
      snapshot.organization.status !== "ACTIVE" ||
      snapshot.organization.workspaceType !== "COMPANY"
    ) {
      throw new AppError(403, "CABINET_DOSSIER_INACTIVE");
    }
    if (!administrator && !snapshot.assignmentExists) {
      throw new AppError(403, "CABINET_DOSSIER_ASSIGNMENT_REQUIRED");
    }

    const accessMode = accessModeForRole(role);

    return {
      accountingFramework: snapshot.organization.accountingFramework,
      accessMode,
      accessSource: "CABINET",
      cabinetId: cabinetAccess.cabinetId,
      cabinetOrgId: workspaceOrgId,
      cabinetRole: role,
      orgId: input.orgId,
      permissions:
        DomainAuthorizationService.permissionsForAccessMode(accessMode),
      workspaceOrgId,
    };
  }

  static assertPermission(
    context: AuthorizedAccountingContext,
    permission: AccountingPermission,
  ): AuthorizedAccountingContext {
    return DomainAuthorizationService.assertPermission(context, permission);
  }

  static async resolve(input: {
    orgId: string;
    permission: AccountingPermission;
    userId: string;
    workspaceOrgId?: string;
  }): Promise<AuthorizedAccountingContext> {
    const context = await this.resolveAccess(input);
    return this.assertPermission(context, input.permission);
  }
}

export { accessModeForRole };
