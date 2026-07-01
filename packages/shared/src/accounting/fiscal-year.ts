import { z } from "zod";

export const FiscalYearStatus = z.enum([
  "OPEN",
  "LOCKED",
  "CLOSED",
  "ARCHIVED",
]);
export type FiscalYearStatus = z.infer<typeof FiscalYearStatus>;

export const AccountingFramework = z.enum(["SYSCOHADA_REVISED", "SYCEBNL"]);
export type AccountingFramework = z.infer<typeof AccountingFramework>;

export const FiscalYearSchema = z.object({
  orgId: z.string(),
  year: z.number(),
  fiscalYearId: z.string(),
  startDate: z.string(), // ISO Date
  endDate: z.string(), // ISO Date
  status: FiscalYearStatus,
  accountingFramework: AccountingFramework,
  ranEntryId: z.string().optional(),
  entityType: z.literal("FISCAL_YEAR"),
  PK: z.string(),
  SK: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FiscalYear = z.infer<typeof FiscalYearSchema>;

export const FiscalYearDtoSchema = z.object({
  orgId: z.string().optional(),
  year: z.number(),
  fiscalYearId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: FiscalYearStatus,
  accountingFramework: AccountingFramework,
  ranEntryId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type FiscalYearDto = z.infer<typeof FiscalYearDtoSchema>;

export const CreateFiscalYearRequestSchema = z
  .object({
    year: z.coerce.number().int().gte(1900).lte(2100),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
  .refine(
    (data) => !data.startDate || data.startDate.startsWith(`${data.year}-`),
    {
      message: "ERROR_FISCAL_YEAR_DATE_MISMATCH",
      path: ["startDate"],
    },
  )
  .refine((data) => !data.endDate || data.endDate.startsWith(`${data.year}-`), {
    message: "ERROR_FISCAL_YEAR_DATE_MISMATCH",
    path: ["endDate"],
  });

export type CreateFiscalYearRequest = z.infer<
  typeof CreateFiscalYearRequestSchema
>;

export const FiscalYearPeriodLocksSchema = z.record(
  z.string().regex(/^\d{2}$/),
  z.enum(["LOCKED", "OPEN"]),
);

export const FiscalYearDetailsDtoSchema = FiscalYearDtoSchema.extend({
  periodLocks: FiscalYearPeriodLocksSchema,
});

export type FiscalYearDetailsDto = z.infer<typeof FiscalYearDetailsDtoSchema>;

export const FiscalYearResponseSchema = z.object({
  message: z.unknown().optional(),
  data: FiscalYearDtoSchema,
});

export const FiscalYearDetailsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: FiscalYearDetailsDtoSchema,
});

export const PeriodLockStatusSchema = z.enum(["LOCKED", "OPEN"]);

export const UpdatePeriodLockRequestSchema = z.object({
  year: z.coerce.number().int().gte(1900).lte(2100),
  month: z.coerce.number().int().gte(1).lte(12),
  status: PeriodLockStatusSchema,
});

export type UpdatePeriodLockRequest = z.infer<
  typeof UpdatePeriodLockRequestSchema
>;

export const PeriodLockDtoSchema = z.object({
  orgId: z.string().optional(),
  year: z.number(),
  month: z.string().regex(/^\d{2}$/),
  status: PeriodLockStatusSchema,
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type PeriodLockDto = z.infer<typeof PeriodLockDtoSchema>;

export const PeriodLockResponseSchema = z.object({
  message: z.unknown().optional(),
  data: PeriodLockDtoSchema,
});

export const CloseFiscalYearRequestSchema = z.object({
  year: z.coerce.string().regex(/^\d{4}$/),
  confirmWarnings: z
    .preprocess(
      (value) => {
        if (value === "true") return true;
        if (value === "false") return false;
        return value;
      },
      z.boolean(),
    )
    .default(false),
});

export type CloseFiscalYearRequest = z.infer<
  typeof CloseFiscalYearRequestSchema
>;

export const ClosePeriodRequestSchema = z.object({
  year: z.coerce.number().int().gte(1900).lte(2100),
  month: z.coerce.number().int().gte(1).lte(12),
});

export type ClosePeriodRequest = z.infer<typeof ClosePeriodRequestSchema>;

export const ClosePeriodResponseSchema = z.object({
  message: z.unknown().optional(),
  data: PeriodLockDtoSchema,
});

export const ClosingIssueScopeSchema = z.enum([
  "FISCAL_YEAR",
  "ENTRY",
  "ENTRY_LINE",
  "TRIAL_BALANCE",
  "JOURNAL",
  "ACCOUNT",
  "AUXILIARY",
]);

export const ClosingIssueDtoSchema = z.object({
  code: z.string().min(1),
  scope: ClosingIssueScopeSchema,
  message: z.string().min(1).optional(),
  entryId: z.string().optional(),
  lineId: z.string().optional(),
  accountId: z.string().regex(/^\d{8}$/).optional(),
  journalCode: z.string().optional(),
  thirdPartyId: z.string().optional(),
});

export type ClosingIssueDto = z.infer<typeof ClosingIssueDtoSchema>;

export const ClosingCheckSummaryDtoSchema = z.object({
  fiscalYear: FiscalYearDtoSchema,
  draftEntriesCount: z.number().int().nonnegative(),
  postedEntriesCount: z.number().int().nonnegative(),
  unbalancedEntriesCount: z.number().int().nonnegative(),
  trialBalanceDebit: z.number().int().nonnegative(),
  trialBalanceCredit: z.number().int().nonnegative(),
  unletteredAuxiliaryLinesCount: z.number().int().nonnegative().optional(),
});

export const ClosingCheckResponseDtoSchema = z.object({
  canClose: z.boolean(),
  errors: z.array(ClosingIssueDtoSchema),
  warnings: z.array(ClosingIssueDtoSchema),
  summary: ClosingCheckSummaryDtoSchema,
});

export type ClosingCheckResponseDto = z.infer<
  typeof ClosingCheckResponseDtoSchema
>;

export const ClosingChecksResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ClosingCheckResponseDtoSchema,
});

export const CloseFiscalYearResultDtoSchema = z.object({
  fiscalYear: FiscalYearDtoSchema,
  checks: ClosingCheckResponseDtoSchema,
});

export type CloseFiscalYearResultDto = z.infer<
  typeof CloseFiscalYearResultDtoSchema
>;

export const CloseFiscalYearResponseSchema = z.object({
  message: z.unknown().optional(),
  data: CloseFiscalYearResultDtoSchema,
});
