import { z } from "zod";

const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const CursorPageRequestShape = {
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().min(1).optional(),
};

const BooleanQuerySchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const CabinetPrioritySchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

export const AccountingWorkTypeSchema = z.enum([
  "ACCOUNTING_ENTRY",
  "BANK_RECONCILIATION",
  "ACCOUNT_REVIEW",
  "MONTHLY_CLOSE",
  "ANNUAL_CLOSE",
  "TAX_DECLARATION",
  "FINANCIAL_STATEMENTS",
  "OTHER",
]);

export const AccountingWorkStatusSchema = z.enum([
  "TO_PLAN",
  "TO_DO",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
]);

export const CabinetDeadlineTypeSchema = z.enum([
  "TAX",
  "ACCOUNTING",
  "REGULATORY",
  "CLIENT",
  "INTERNAL",
  "OTHER",
]);

export const CabinetDeadlineStatusSchema = z.enum([
  "PENDING",
  "COMPLETED",
  "CANCELLED",
]);

const titleSchema = z.string().trim().min(1).max(160);
const descriptionSchema = z.string().trim().min(1).max(4000).optional();
const participantUserIdsSchema = z
  .array(z.string().trim().min(1))
  .max(50)
  .default([])
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "Participant user identifiers must be unique",
      });
    }
  });

const validateWorkDates = <T extends {
  dueDate?: string;
  periodEnd?: string;
  periodStart?: string;
  startDate?: string;
}>(
  value: T,
  context: z.RefinementCtx,
) => {
  if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
    context.addIssue({
      code: "custom",
      message: "periodStart must be before or equal to periodEnd",
      path: ["periodEnd"],
    });
  }
  if (value.startDate && value.dueDate && value.startDate > value.dueDate) {
    context.addIssue({
      code: "custom",
      message: "startDate must be before or equal to dueDate",
      path: ["dueDate"],
    });
  }
};

export const AccountingWorkSchema = z
  .object({
    workId: z.string().min(1),
    cabinetOrgId: z.string().min(1),
    dossierOrgId: z.string().min(1),
    dossierName: z.string().min(1).optional(),
    type: AccountingWorkTypeSchema,
    title: titleSchema,
    description: descriptionSchema,
    periodStart: DateOnlySchema.optional(),
    periodEnd: DateOnlySchema.optional(),
    startDate: DateOnlySchema.optional(),
    dueDate: DateOnlySchema.optional(),
    priority: CabinetPrioritySchema,
    status: AccountingWorkStatusSchema,
    responsibleUserId: z.string().min(1).optional(),
    responsibleDisplayName: z.string().min(1).optional(),
    participantUserIds: z.array(z.string().min(1)).default([]),
    createdBy: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedBy: z.string().min(1),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    completedBy: z.string().min(1).optional(),
    cancelledAt: z.string().datetime().optional(),
    cancelledBy: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(validateWorkDates);

export const AccountingWorkSummarySchema = AccountingWorkSchema;

export const CreateAccountingWorkRequestSchema = z
  .object({
    dossierOrgId: z.string().trim().min(1),
    type: AccountingWorkTypeSchema,
    title: titleSchema,
    description: descriptionSchema,
    periodStart: DateOnlySchema.optional(),
    periodEnd: DateOnlySchema.optional(),
    startDate: DateOnlySchema.optional(),
    dueDate: DateOnlySchema.optional(),
    priority: CabinetPrioritySchema.default("NORMAL"),
    responsibleUserId: z.string().trim().min(1).optional(),
    participantUserIds: participantUserIdsSchema,
  })
  .strict()
  .superRefine(validateWorkDates);

export const UpdateAccountingWorkRequestSchema = z
  .object({
    workId: z.string().min(1),
    type: AccountingWorkTypeSchema.optional(),
    title: titleSchema.optional(),
    description: z.string().trim().min(1).max(4000).nullable().optional(),
    periodStart: DateOnlySchema.nullable().optional(),
    periodEnd: DateOnlySchema.nullable().optional(),
    startDate: DateOnlySchema.nullable().optional(),
    dueDate: DateOnlySchema.nullable().optional(),
    priority: CabinetPrioritySchema.optional(),
    responsibleUserId: z.string().trim().min(1).nullable().optional(),
    participantUserIds: participantUserIdsSchema.optional(),
  })
  .strict();

export const UpdateAccountingWorkStatusRequestSchema = z
  .object({
    workId: z.string().min(1),
    status: AccountingWorkStatusSchema,
    currentStatus: AccountingWorkStatusSchema.optional(),
  })
  .strict();

export const ListAccountingWorksRequestSchema = z
  .object({
    ...CursorPageRequestShape,
    dossierOrgId: z.string().trim().min(1).optional(),
    type: AccountingWorkTypeSchema.optional(),
    status: AccountingWorkStatusSchema.optional(),
    priority: CabinetPrioritySchema.optional(),
    responsibleUserId: z.string().trim().min(1).optional(),
    dueFrom: DateOnlySchema.optional(),
    dueTo: DateOnlySchema.optional(),
    periodStart: DateOnlySchema.optional(),
    periodEnd: DateOnlySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) {
      context.addIssue({
        code: "custom",
        message: "dueFrom must be before or equal to dueTo",
        path: ["dueTo"],
      });
    }
    if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
      context.addIssue({
        code: "custom",
        message: "periodStart must be before or equal to periodEnd",
        path: ["periodEnd"],
      });
    }
  });

export const GetAccountingWorkResponseSchema = z
  .object({ work: AccountingWorkSchema })
  .strict();

export const ListAccountingWorksResponseSchema = z
  .object({
    works: AccountingWorkSummarySchema.array(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    hasMore: value.hasMore ?? Boolean(value.nextCursor),
  }));

export const CabinetDeadlineSchema = z
  .object({
    deadlineId: z.string().min(1),
    cabinetOrgId: z.string().min(1),
    dossierOrgId: z.string().min(1),
    dossierName: z.string().min(1).optional(),
    type: CabinetDeadlineTypeSchema,
    title: titleSchema,
    description: descriptionSchema,
    dueDate: DateOnlySchema,
    priority: CabinetPrioritySchema,
    status: CabinetDeadlineStatusSchema,
    responsibleUserId: z.string().min(1).optional(),
    responsibleDisplayName: z.string().min(1).optional(),
    linkedWorkId: z.string().min(1).optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedBy: z.string().min(1),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    completedBy: z.string().min(1).optional(),
    cancelledAt: z.string().datetime().optional(),
    cancelledBy: z.string().min(1).optional(),
  })
  .strict();

export const CabinetDeadlineSummarySchema = CabinetDeadlineSchema;

export const CreateCabinetDeadlineRequestSchema = z
  .object({
    dossierOrgId: z.string().trim().min(1),
    type: CabinetDeadlineTypeSchema,
    title: titleSchema,
    description: descriptionSchema,
    dueDate: DateOnlySchema,
    priority: CabinetPrioritySchema.default("NORMAL"),
    responsibleUserId: z.string().trim().min(1).optional(),
    linkedWorkId: z.string().trim().min(1).optional(),
  })
  .strict();

export const UpdateCabinetDeadlineRequestSchema = z
  .object({
    deadlineId: z.string().min(1),
    type: CabinetDeadlineTypeSchema.optional(),
    title: titleSchema.optional(),
    description: z.string().trim().min(1).max(4000).nullable().optional(),
    dueDate: DateOnlySchema.optional(),
    priority: CabinetPrioritySchema.optional(),
    responsibleUserId: z.string().trim().min(1).nullable().optional(),
    linkedWorkId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const UpdateCabinetDeadlineStatusRequestSchema = z
  .object({
    deadlineId: z.string().min(1),
    status: CabinetDeadlineStatusSchema,
    currentStatus: CabinetDeadlineStatusSchema.optional(),
  })
  .strict();

export const ListCabinetDeadlinesRequestSchema = z
  .object({
    ...CursorPageRequestShape,
    dossierOrgId: z.string().trim().min(1).optional(),
    type: CabinetDeadlineTypeSchema.optional(),
    status: CabinetDeadlineStatusSchema.optional(),
    priority: CabinetPrioritySchema.optional(),
    responsibleUserId: z.string().trim().min(1).optional(),
    dueFrom: DateOnlySchema.optional(),
    dueTo: DateOnlySchema.optional(),
    overdue: BooleanQuerySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) {
      context.addIssue({
        code: "custom",
        message: "dueFrom must be before or equal to dueTo",
        path: ["dueTo"],
      });
    }
  });

export const GetCabinetDeadlineResponseSchema = z
  .object({ deadline: CabinetDeadlineSchema })
  .strict();

export const ListCabinetDeadlinesResponseSchema = z
  .object({
    deadlines: CabinetDeadlineSummarySchema.array(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    hasMore: value.hasMore ?? Boolean(value.nextCursor),
  }));

export type CabinetPriority = z.infer<typeof CabinetPrioritySchema>;
export type AccountingWorkType = z.infer<typeof AccountingWorkTypeSchema>;
export type AccountingWorkStatus = z.infer<typeof AccountingWorkStatusSchema>;
export type CabinetDeadlineType = z.infer<typeof CabinetDeadlineTypeSchema>;
export type CabinetDeadlineStatus = z.infer<typeof CabinetDeadlineStatusSchema>;
export type AccountingWork = z.infer<typeof AccountingWorkSchema>;
export type AccountingWorkSummary = z.infer<typeof AccountingWorkSummarySchema>;
export type CreateAccountingWorkRequest = z.infer<
  typeof CreateAccountingWorkRequestSchema
>;
export type UpdateAccountingWorkRequest = z.infer<
  typeof UpdateAccountingWorkRequestSchema
>;
export type UpdateAccountingWorkStatusRequest = z.infer<
  typeof UpdateAccountingWorkStatusRequestSchema
>;
export type ListAccountingWorksRequest = z.infer<
  typeof ListAccountingWorksRequestSchema
>;
export type ListAccountingWorksResponse = z.infer<
  typeof ListAccountingWorksResponseSchema
>;
export type CabinetDeadline = z.infer<typeof CabinetDeadlineSchema>;
export type CabinetDeadlineSummary = z.infer<typeof CabinetDeadlineSummarySchema>;
export type CreateCabinetDeadlineRequest = z.infer<
  typeof CreateCabinetDeadlineRequestSchema
>;
export type UpdateCabinetDeadlineRequest = z.infer<
  typeof UpdateCabinetDeadlineRequestSchema
>;
export type UpdateCabinetDeadlineStatusRequest = z.infer<
  typeof UpdateCabinetDeadlineStatusRequestSchema
>;
export type ListCabinetDeadlinesRequest = z.infer<
  typeof ListCabinetDeadlinesRequestSchema
>;
export type ListCabinetDeadlinesResponse = z.infer<
  typeof ListCabinetDeadlinesResponseSchema
>;
