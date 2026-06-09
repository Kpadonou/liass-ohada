import { z } from "zod";

export const ProjectStatus = z.enum([
  "ACTIVE",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
]);

export const ProjectSchema = z.object({
  orgId: z.string(),
  projectId: z.string(), // Technical ID (Internal link)
  projectCode: z.string(), // Business Code (Human reference)
  name: z.string(),
  description: z.string().optional(),

  // Funding context
  donorId: z.string(), // Linked to Third-Party
  managerId: z.string(), // Responsible user
  contractRef: z.string().optional(), // Funder's contract number

  // Financials
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  totalBudget: z.number().int(),
  annualBudgets: z.record(z.string(), z.number().min(0)).default({}),
  currency: z.string().default("XOF"), // Multi-currency support
  currentSpending: z.number().int().default(0),

  status: ProjectStatus.default("ACTIVE"),
  entityType: z.literal("PROJECT"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectDtoSchema = ProjectSchema.omit({
  entityType: true,
});

export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const CreateProjectRequestSchema = ProjectSchema.omit({
  orgId: true,
  projectId: true,
  currentSpending: true,
  entityType: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const ProjectResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ProjectDtoSchema,
});

export const ListProjectsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    projects: z.array(ProjectDtoSchema),
  }),
});

export const ProjectReportDtoSchema = z.object({
  projectInfo: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    donorList: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        budget: z.number(),
      }),
    ),
  }),
  financialPosition: z.object({
    totalResources: z.number(),
    totalExpenses: z.number(),
    netCash: z.number(),
  }),
  fundingFollowUp: z.array(
    z.object({
      donorId: z.string(),
      label: z.string(),
      promised: z.number(),
      received: z.number(),
      spent: z.number(),
      availableCash: z.number(),
      remainingToReceive: z.number(),
      disbursementRate: z.number(),
    }),
  ),
  budgetVsActual: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      allocated: z.number(),
      donors: z.record(z.string(), z.number()),
      unallocated: z.number(),
      spent: z.number(),
      remaining: z.number(),
      executionRate: z.number(),
    }),
  ),
  accountDetails: z.array(
    z.object({
      accountId: z.string(),
      debit: z.number(),
      credit: z.number(),
      balance: z.number(),
      formattedBalance: z.string(),
    }),
  ),
  metadata: z.object({
    generatedAt: z.string(),
    reportYear: z.string(),
    organizationId: z.string(),
  }),
});

export type ProjectReportDto = z.infer<typeof ProjectReportDtoSchema>;

export const ProjectReportResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ProjectReportDtoSchema,
});

export const ProjectSummaryDtoSchema = z.object({
  projectInfo: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    donor: z.string(),
    status: ProjectStatus,
  }),
  financials: z.object({
    netPosition: z.number(),
    globalExecutionRate: z.number(),
    annualExecutionRate: z.number(),
  }),
  alerts: z.object({
    isOverSpentGlobal: z.boolean(),
    isOverSpentAnnual: z.boolean(),
    isCashNegative: z.boolean(),
  }),
});

export type ProjectSummaryDto = z.infer<typeof ProjectSummaryDtoSchema>;

export const ProjectsSummaryResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.array(ProjectSummaryDtoSchema),
});
