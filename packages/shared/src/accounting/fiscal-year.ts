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
    accountingFramework: AccountingFramework.default("SYSCOHADA_REVISED"),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
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
});

export type CloseFiscalYearRequest = z.infer<
  typeof CloseFiscalYearRequestSchema
>;

export const CloseFiscalYearResultDtoSchema = z.object({
  entryId: z.string(),
  netResult: z.number().int().nonnegative(),
  isProfit: z.boolean(),
});

export type CloseFiscalYearResultDto = z.infer<
  typeof CloseFiscalYearResultDtoSchema
>;

export const CloseFiscalYearResponseSchema = z.object({
  message: z.unknown().optional(),
  data: CloseFiscalYearResultDtoSchema,
});
