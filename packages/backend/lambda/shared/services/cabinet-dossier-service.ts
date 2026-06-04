import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  CabinetDossierSummarySchema,
  CreateCabinetDossierRequest,
  CreateCabinetDossierRequestSchema,
  CreateCabinetDossierResponse,
  CreateCabinetDossierResponseSchema,
  ListCabinetDossiersResponse,
  ListCabinetDossiersResponseSchema,
  Organization,
  WorkspaceSummary,
} from "@liass-ohada/shared";
import { randomUUID } from "crypto";
import { AppError } from "../app-error";
import { CabinetDossierRepository } from "../repositories/cabinet-dossier-repository";

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
  ): Promise<ListCabinetDossiersResponse> {
    const cabinetId = assertAccountingFirmContext(context);
    const dossiers = await CabinetDossierRepository.listClientDossiers({
      cabinetId,
      cabinetOrgId: context.orgId,
    });

    return ListCabinetDossiersResponseSchema.parse({ dossiers });
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
