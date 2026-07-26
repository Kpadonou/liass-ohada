import { z } from "zod";
import {
  AccountingWorkStatusSchema,
  AccountingWorkTypeSchema,
  CabinetDeadlineStatusSchema,
  CabinetDeadlineTypeSchema,
  CabinetPrioritySchema,
} from "./cabinet-operations";

const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const nonNegativeInteger = z.number().int().min(0);

export const CabinetDashboardScopeSchema = z.enum([
  "CABINET",
  "SUPERVISED_DOSSIERS",
  "PERSONAL_ACTIVITY",
  "ASSIGNED_DOSSIERS_READ_ONLY",
]);

export const CabinetDashboardRequestSchema = z
  .object({
    attentionLimit: z.coerce.number().int().min(1).max(10).default(5).optional(),
  })
  .strict();

export const CabinetDashboardCabinetSchema = z
  .object({
    cabinetOrgId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export const CabinetDashboardPortfolioSchema = z
  .object({
    accessibleDossiers: nonNegativeInteger,
    activeDossiers: nonNegativeInteger,
  })
  .strict();

export const CabinetDashboardTeamSchema = z
  .object({
    activeMembers: nonNegativeInteger,
    administrators: nonNegativeInteger,
    supervisors: nonNegativeInteger,
    collaborators: nonNegativeInteger,
    readers: nonNegativeInteger,
    pendingInvitations: nonNegativeInteger.optional(),
  })
  .strict();

export const CabinetDashboardWorkMetricsSchema = z
  .object({
    totalActive: nonNegativeInteger,
    toPlan: nonNegativeInteger,
    toDo: nonNegativeInteger,
    inProgress: nonNegativeInteger,
    waiting: nonNegativeInteger,
    overdue: nonNegativeInteger,
    dueSoon: nonNegativeInteger,
    unassigned: nonNegativeInteger.optional(),
  })
  .strict();

export const CabinetDashboardDeadlineMetricsSchema = z
  .object({
    pending: nonNegativeInteger,
    overdue: nonNegativeInteger,
    dueToday: nonNegativeInteger,
    next7Days: nonNegativeInteger,
    next30Days: nonNegativeInteger,
  })
  .strict();

export const CabinetDashboardWorkAttentionItemSchema = z
  .object({
    workId: z.string().min(1),
    dossierOrgId: z.string().min(1),
    dossierName: z.string().min(1).optional(),
    title: z.string().min(1),
    type: AccountingWorkTypeSchema,
    priority: CabinetPrioritySchema,
    status: AccountingWorkStatusSchema,
    responsibleUserId: z.string().min(1).optional(),
    responsibleDisplayName: z.string().min(1).optional(),
    dueDate: DateOnlySchema,
  })
  .strict();

export const CabinetDashboardDeadlineAttentionItemSchema = z
  .object({
    deadlineId: z.string().min(1),
    dossierOrgId: z.string().min(1),
    dossierName: z.string().min(1).optional(),
    title: z.string().min(1),
    type: CabinetDeadlineTypeSchema,
    priority: CabinetPrioritySchema,
    status: CabinetDeadlineStatusSchema,
    responsibleUserId: z.string().min(1).optional(),
    responsibleDisplayName: z.string().min(1).optional(),
    dueDate: DateOnlySchema,
    linkedWorkId: z.string().min(1).optional(),
  })
  .strict();

export const CabinetDashboardAttentionSchema = z
  .object({
    overdueWorks: CabinetDashboardWorkAttentionItemSchema.array().max(10),
    overdueDeadlines: CabinetDashboardDeadlineAttentionItemSchema.array().max(10),
    upcomingDeadlines: CabinetDashboardDeadlineAttentionItemSchema.array().max(10),
    unassignedWorks: CabinetDashboardWorkAttentionItemSchema.array().max(10).optional(),
  })
  .strict();

export const CabinetDashboardResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    asOfDate: DateOnlySchema,
    scope: CabinetDashboardScopeSchema,
    cabinet: CabinetDashboardCabinetSchema,
    portfolio: CabinetDashboardPortfolioSchema,
    team: CabinetDashboardTeamSchema.optional(),
    work: CabinetDashboardWorkMetricsSchema,
    deadlines: CabinetDashboardDeadlineMetricsSchema,
    attention: CabinetDashboardAttentionSchema,
  })
  .strict();

export type CabinetDashboardScope = z.infer<typeof CabinetDashboardScopeSchema>;
export type CabinetDashboardRequest = z.infer<
  typeof CabinetDashboardRequestSchema
>;
export type CabinetDashboardResponse = z.infer<
  typeof CabinetDashboardResponseSchema
>;
