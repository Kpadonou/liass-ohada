import { z } from "zod";

export const WorkspaceTypeSchema = z.enum(["COMPANY", "ACCOUNTING_FIRM"]);

export const OnboardingAccountingFrameworkSchema = z.enum([
  "SYSCOHADA_REVISED",
  "SYCEBNL",
]);

export const WorkspaceCountrySchema = z.enum([
  "BJ",
  "TG",
  "CI",
  "SN",
  "BF",
  "ML",
  "NE",
  "CM",
  "CG",
  "GA",
  "TD",
  "CF",
  "GN",
  "GW",
  "GQ",
  "CD",
  "KM",
]);

export const WorkspaceStatusSchema = z.enum(["ACTIVE"]);

export const WorkspaceSummarySchema = z
  .object({
    orgId: z.string().min(1),
    role: z.string().optional(),
    cabinetId: z.string().optional(),
    accessSource: z.string().optional(),
    displayName: z.string().optional(),
    workspaceType: WorkspaceTypeSchema.optional(),
    status: WorkspaceStatusSchema.optional(),
    country: WorkspaceCountrySchema.optional(),
    accountingFramework: OnboardingAccountingFrameworkSchema.optional(),
  })
  .strict();

export const WorkspacesResponseSchema = z
  .object({
    workspaces: WorkspaceSummarySchema.array(),
  })
  .strict();

export const CreateInitialWorkspaceRequestSchema = z
  .object({
    workspaceType: WorkspaceTypeSchema,
    organizationName: z.string().trim().min(1).max(160),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema,
  })
  .strict();

export const OrganizationSchema = z
  .object({
    orgId: z.string().min(1),
    name: z.string().min(1),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema,
    workspaceType: WorkspaceTypeSchema,
    status: WorkspaceStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const CabinetSchema = z
  .object({
    cabinetId: z.string().min(1),
    orgId: z.string().min(1),
    name: z.string().min(1),
    country: WorkspaceCountrySchema,
    status: WorkspaceStatusSchema,
    ownerUserId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const InitialWorkspaceOrganizationSchema = OrganizationSchema;

export const LegacyInitialWorkspaceOrganizationSchema = z.object({
  orgId: z.string().min(1),
  displayName: z.string().min(1),
  workspaceType: WorkspaceTypeSchema,
  status: WorkspaceStatusSchema,
  country: WorkspaceCountrySchema,
  accountingFramework: OnboardingAccountingFrameworkSchema,
  cabinetId: z.string().min(1).optional(),
});

export const CreateInitialWorkspaceResponseSchema = z
  .object({
    organization: OrganizationSchema,
    cabinet: CabinetSchema.nullable(),
    workspace: WorkspaceSummarySchema,
    activeOrgId: z.string().min(1),
  })
  .strict();

export const CabinetDossierSummarySchema = z
  .object({
    orgId: z.string().min(1),
    displayName: z.string().min(1),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema,
    status: WorkspaceStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ListCabinetDossiersResponseSchema = z
  .object({
    dossiers: CabinetDossierSummarySchema.array(),
  })
  .strict();

export const CreateCabinetDossierRequestSchema = z
  .object({
    companyName: z.string().trim().min(1).max(160),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema,
  })
  .strict();

export const CreateCabinetDossierResponseSchema = z
  .object({
    dossier: CabinetDossierSummarySchema,
    activeDossierOrgId: z.string().min(1),
  })
  .strict();

export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;
export type OnboardingAccountingFramework = z.infer<
  typeof OnboardingAccountingFrameworkSchema
>;
export type WorkspaceCountry = z.infer<typeof WorkspaceCountrySchema>;
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspacesResponse = z.infer<typeof WorkspacesResponseSchema>;
export type CreateInitialWorkspaceRequest = z.infer<
  typeof CreateInitialWorkspaceRequestSchema
>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Cabinet = z.infer<typeof CabinetSchema>;
export type InitialWorkspaceOrganization = z.infer<
  typeof InitialWorkspaceOrganizationSchema
>;
export type CreateInitialWorkspaceResponse = z.infer<
  typeof CreateInitialWorkspaceResponseSchema
>;
export type CabinetDossierSummary = z.infer<typeof CabinetDossierSummarySchema>;
export type ListCabinetDossiersResponse = z.infer<
  typeof ListCabinetDossiersResponseSchema
>;
export type CreateCabinetDossierRequest = z.infer<
  typeof CreateCabinetDossierRequestSchema
>;
export type CreateCabinetDossierResponse = z.infer<
  typeof CreateCabinetDossierResponseSchema
>;
