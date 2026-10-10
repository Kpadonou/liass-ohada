import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  CabinetDossierSummarySchema,
  CreateCabinetDossierRequest,
  CreateCabinetDossierRequestSchema,
  CreateCabinetDossierResponse,
  CreateCabinetDossierResponseSchema,
  ListCabinetDossiersResponse,
  ListCabinetDossiersResponseSchema,
  ListCabinetDossiersRequest,
  ListCabinetDossiersRequestSchema,
  Organization,
  WorkspaceSummary,
} from "@liass-ohada/shared";
import { randomUUID } from "crypto";
import { AppError } from "../app-error";
import { CabinetDossierRepository } from "../repositories/cabinet-dossier-repository";
import { CabinetTeamRepository } from "../repositories/cabinet-team-repository";
import { CabinetAuthorizationService } from "./cabinet-authorization-service";
import { ProductAccessService } from "./product-access-service";
import { AccountingSettingsService } from "@/lambda/domains/accounting/settings/accounting-settings-service";

interface CabinetContext {
  orgId: string;
  userId: string;
  cabinetId?: string;
  workspaceType?: "COMPANY" | "ACCOUNTING_FIRM";
}

function assertAccountingFirmContext(context: CabinetContext): string {
  if (context.workspaceType !== "ACCOUNTING_FIRM" || !context.cabinetId) {
    throw new AppError(403, "ERROR_CABINET_WORKSPACE_REQUIRED");
  }

  return context.cabinetId;
}

function isTransactionCanceled(error: unknown): boolean {
  return error instanceof TransactionCanceledException;
}

function createOrgId(): string {
  return `org-${randomUUID()}`;
}

export class CabinetDossierService {
  static async listClientDossiers(
    context: CabinetContext,
    input: ListCabinetDossiersRequest = {},
  ): Promise<ListCabinetDossiersResponse> {
    const cabinetId = assertAccountingFirmContext(context);
    const request = ListCabinetDossiersRequestSchema.parse(input);
    const authorized =
      await CabinetAuthorizationService.requireActiveMembership({
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      });
    if (authorized.caller.cabinetRole === "CABINET_ADMIN") {
      const dossiers = await CabinetDossierRepository.listClientDossiers({
        cabinetId,
        cabinetOrgId: context.orgId,
      });
      return ListCabinetDossiersResponseSchema.parse({
        dossiers: dossiers.map((dossier) => ({
          ...dossier,
          accessMode: "READ_WRITE",
        })),
      });
    }

    const limit = request.limit ?? 50;
    const dossiers: ListCabinetDossiersResponse["dossiers"] = [];
    let cursor = request.cursor;
    let iteration = 0;
    const maximumInternalPageFetches = 3;

    do {
      const page = await CabinetTeamRepository.listMemberAssignmentsPage({
        cabinetOrgId: authorized.cabinetOrgId,
        cursor,
        limit: Math.min(50, Math.max(1, limit - dossiers.length)),
        userId: context.userId,
      });
      cursor = page.nextCursor;
      const relationships = await CabinetTeamRepository.getCurrentDossiers(
        cabinetId,
        page.items.map((assignment) => assignment.dossierOrgId),
      );
      for (const relationship of relationships) {
        const parsed = CabinetDossierSummarySchema.safeParse({
          accessMode:
            authorized.caller.cabinetRole === "READER"
              ? "READ_ONLY"
              : "READ_WRITE",
          accountingFramework: relationship.accountingFramework,
          country: relationship.country,
          createdAt: relationship.createdAt,
          displayName: relationship.displayName,
          orgId: relationship.orgId,
          status: relationship.status,
          updatedAt: relationship.updatedAt,
        });
        if (
          relationship.cabinetId === cabinetId &&
          relationship.relationship === "CLIENT" &&
          relationship.status === "ACTIVE" &&
          parsed.success
        ) {
          dossiers.push(parsed.data);
        }
      }
      iteration += 1;
    } while (
      cursor &&
      dossiers.length < limit &&
      iteration < maximumInternalPageFetches
    );

    return ListCabinetDossiersResponseSchema.parse({
      dossiers: dossiers.slice(0, limit),
      nextCursor: cursor,
    });
  }

  static async createClientDossier(
    context: CabinetContext,
    data: CreateCabinetDossierRequest,
  ): Promise<CreateCabinetDossierResponse> {
    const cabinetId = assertAccountingFirmContext(context);
    const request = CreateCabinetDossierRequestSchema.parse(data);
    const now = new Date().toISOString();
    const organization: Organization = {
      orgId: createOrgId(),
      name: request.companyName,
      country: request.country,
      accountingFramework: request.accountingFramework,
      workspaceType: "COMPANY",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    const workspace: WorkspaceSummary = {
      orgId: organization.orgId,
      role: "OWNER",
      cabinetId,
      accessSource: "CABINET",
      displayName: organization.name,
      workspaceType: "COMPANY",
      status: "ACTIVE",
      country: organization.country,
      accountingFramework: organization.accountingFramework,
    };

    try {
      await CabinetDossierRepository.createClientDossierItems({
        userId: context.userId,
        cabinetId,
        organization,
        workspace,
        productAccessWrites:
          ProductAccessService.buildCompatibilityBaselineWrites(
            organization.orgId,
            now,
          ),
        accountingSettingsWrite: AccountingSettingsService.buildOnboardingWrite(
          {
            orgId: organization.orgId,
            accountingFramework: request.accountingFramework,
            timestamp: now,
          },
        ),
      });
    } catch (error) {
      if (isTransactionCanceled(error)) {
        throw new AppError(409, "CABINET_DOSSIER_ALREADY_EXISTS");
      }

      throw new AppError(500, "CABINET_DOSSIER_CREATE_FAILED");
    }

    const dossier = CabinetDossierSummarySchema.parse({
      orgId: organization.orgId,
      displayName: organization.name,
      country: organization.country,
      accountingFramework: organization.accountingFramework,
      status: organization.status,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    });

    return CreateCabinetDossierResponseSchema.parse({
      dossier,
      activeDossierOrgId: dossier.orgId,
    });
  }
}
