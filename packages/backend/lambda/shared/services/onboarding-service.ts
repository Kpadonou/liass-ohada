import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  Cabinet,
  CreateInitialWorkspaceRequest,
  CreateInitialWorkspaceRequestSchema,
  CreateInitialWorkspaceResponse,
  CreateInitialWorkspaceResponseSchema,
  Organization,
  WorkspaceSummary,
} from "@liass-ohada/shared";
import { randomUUID } from "crypto";
import { AppError } from "../app-error";
import { OnboardingRepository } from "../repositories/onboarding-repository";

const ACCESS_STATUS = "ACTIVE" as const;
const OWNER_ROLE = "OWNER" as const;
const ACCESS_SOURCE = "DIRECT" as const;

export class OnboardingService {
  static async createInitialWorkspace(
    userId: string,
    data: CreateInitialWorkspaceRequest,
  ): Promise<CreateInitialWorkspaceResponse> {
    const request = CreateInitialWorkspaceRequestSchema.parse(data);
    const existingWorkspaces =
      await OnboardingRepository.listActiveUserWorkspaces(userId);

    if (existingWorkspaces.length > 0) {
      throw new AppError(409, "WORKSPACE_ALREADY_EXISTS");
    }

    const now = new Date().toISOString();
    const orgId = `org-${randomUUID()}`;
    const cabinetId =
      request.workspaceType === "ACCOUNTING_FIRM"
        ? `cab-${randomUUID()}`
        : undefined;
    const organizationName = request.organizationName.trim();
    const organization: Organization = {
      orgId,
      name: organizationName,
      country: request.country,
      accountingFramework: request.accountingFramework,
      workspaceType: request.workspaceType,
      status: ACCESS_STATUS,
      createdAt: now,
      updatedAt: now,
    };
    const cabinet: Cabinet | null = cabinetId
      ? {
          cabinetId,
          orgId,
          name: organizationName,
          country: request.country,
          status: ACCESS_STATUS,
          ownerUserId: userId,
          createdAt: now,
          updatedAt: now,
        }
      : null;
    const workspace: WorkspaceSummary = {
      orgId,
      role: OWNER_ROLE,
      cabinetRole:
        request.workspaceType === "ACCOUNTING_FIRM"
          ? "CABINET_ADMIN"
          : undefined,
      cabinetId,
      accessSource: ACCESS_SOURCE,
      displayName: organizationName,
      workspaceType: request.workspaceType,
      status: ACCESS_STATUS,
      country: request.country,
      accountingFramework: request.accountingFramework,
    };

    try {
      await OnboardingRepository.createInitialWorkspaceItems({
        userId,
        organization,
        cabinet,
        workspace,
      });
      if (cabinet) {
        console.info("[CABINET_SETTINGS_AUDIT]", {
          action: "CREATED",
          actorUserId: userId,
          cabinetOrgId: organization.orgId,
          changedFields: [
            "preferredLanguage",
            "defaults.country",
            "defaults.accountingFramework",
          ],
          previousVersion: 0,
          newVersion: 1,
          timestamp: now,
        });
      }
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(409, "WORKSPACE_ALREADY_EXISTS");
      }

      throw new AppError(500, "ONBOARDING_CREATE_FAILED");
    }

    return CreateInitialWorkspaceResponseSchema.parse({
      organization,
      cabinet,
      workspace,
      activeOrgId: orgId,
    });
  }
}
