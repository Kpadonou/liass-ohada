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

export const WorkspaceSummarySchema = z.object({
  orgId: z.string().min(1),
  role: z.string().optional(),
  cabinetId: z.string().optional(),
  accessSource: z.string().optional(),
  displayName: z.string().optional(),
  workspaceType: WorkspaceTypeSchema.optional(),
  status: WorkspaceStatusSchema.optional(),
  country: WorkspaceCountrySchema.optional(),
  accountingFramework: OnboardingAccountingFrameworkSchema.optional(),
});

export const WorkspacesResponseSchema = z.object({
  workspaces: WorkspaceSummarySchema.array(),
});

export const CreateInitialWorkspaceRequestSchema = z
  .object({
    workspaceType: WorkspaceTypeSchema,
    organizationName: z.string().trim().min(1).max(160),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema,
  })
  .strict();

export const InitialWorkspaceOrganizationSchema = z.object({
  orgId: z.string().min(1),
  displayName: z.string().min(1),
  workspaceType: WorkspaceTypeSchema,
  status: WorkspaceStatusSchema,
  country: WorkspaceCountrySchema,
  accountingFramework: OnboardingAccountingFrameworkSchema,
  cabinetId: z.string().min(1).optional(),
});

export const CreateInitialWorkspaceResponseSchema = z.object({
  organization: InitialWorkspaceOrganizationSchema,
  workspace: WorkspaceSummarySchema,
  activeOrgId: z.string().min(1),
});

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
export type InitialWorkspaceOrganization = z.infer<
  typeof InitialWorkspaceOrganizationSchema
>;
export type CreateInitialWorkspaceResponse = z.infer<
  typeof CreateInitialWorkspaceResponseSchema
>;
