import { ProductAccessSchema, ProductCodeSchema } from "./product-access";
import { ProductRolesSchema } from "./restaurants-access";
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

export const AccountingAccessModeSchema = z.enum(["READ_WRITE", "READ_ONLY"]);

export const WorkspaceSummarySchema = z
  .object({
    orgId: z.string().min(1),
    role: z.string().optional(),
    productRoles: ProductRolesSchema.optional(),
    cabinetRole: z
      .enum(["CABINET_ADMIN", "SUPERVISOR", "COLLABORATOR", "READER"])
      .optional(),
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

const InitialWorkspaceFields = {
  organizationName: z.string().trim().min(1).max(160),
  country: WorkspaceCountrySchema,
};

export const CreateInitialWorkspaceRequestSchema = z
  .discriminatedUnion("workspaceType", [
    z
      .object({
        ...InitialWorkspaceFields,
        workspaceType: z.literal("COMPANY"),
        products: z
          .array(ProductCodeSchema)
          .min(1)
          .max(3)
          .refine((products) => new Set(products).size === products.length, {
            message: "Products must be unique",
          }),
        accountingFramework: OnboardingAccountingFrameworkSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...InitialWorkspaceFields,
        workspaceType: z.literal("ACCOUNTING_FIRM"),
        accountingFramework: OnboardingAccountingFrameworkSchema,
      })
      .strict(),
  ])
  .superRefine((request, context) => {
    if (request.workspaceType !== "COMPANY") return;
    const accountingSelected = request.products.includes("ACCOUNTING");
    if (accountingSelected !== (request.accountingFramework !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountingFramework"],
        message: accountingSelected
          ? "Accounting framework is required for ACCOUNTING"
          : "Accounting framework requires ACCOUNTING",
      });
    }
  });

export const OrganizationSchema = z
  .object({
    orgId: z.string().min(1),
    name: z.string().min(1),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema.optional(),
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
    productAccess: z.array(ProductAccessSchema).optional(),
  })
  .strict();

export const CabinetDossierSummarySchema = z
  .object({
    orgId: z.string().min(1),
    displayName: z.string().min(1),
    country: WorkspaceCountrySchema,
    accountingFramework: OnboardingAccountingFrameworkSchema,
    status: WorkspaceStatusSchema,
    accessMode: AccountingAccessModeSchema.default("READ_WRITE"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ListCabinetDossiersResponseSchema = z
  .object({
    dossiers: CabinetDossierSummarySchema.array(),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export const ListCabinetDossiersRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().min(1).optional(),
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
export type AccountingAccessMode = z.infer<typeof AccountingAccessModeSchema>;
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
// Input compatibility keeps pre-C3.2 callers valid; schema parsing always
// materializes READ_WRITE when an older payload omits accessMode.
export type CabinetDossierSummary = z.input<typeof CabinetDossierSummarySchema>;
export type ListCabinetDossiersResponse = z.infer<
  typeof ListCabinetDossiersResponseSchema
>;
export type ListCabinetDossiersRequest = z.infer<
  typeof ListCabinetDossiersRequestSchema
>;
export type CreateCabinetDossierRequest = z.infer<
  typeof CreateCabinetDossierRequestSchema
>;
export type CreateCabinetDossierResponse = z.infer<
  typeof CreateCabinetDossierResponseSchema
>;
