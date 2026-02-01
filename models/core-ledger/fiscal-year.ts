import { z } from "zod";

export const FiscalYearStatus = z.enum([
  "OPEN",
  "LOCKED",
  "CLOSED",
  "ARCHIVED",
]);
export const AccountingStandard = z.enum(["SYSCOHADA_GENERAL", "SYCEBNL"]);

export const FiscalYearSchema = z.object({
  orgId: z.string(),
  year: z.number(),
  fiscalYearId: z.string(),
  startDate: z.string(), // ISO Date
  endDate: z.string(), // ISO Date
  status: FiscalYearStatus,
  accountingStandard: AccountingStandard,
  ranEntryId: z.string().optional(),
  entityType: z.literal("FISCAL_YEAR"),
  PK: z.string(),
  SK: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FiscalYear = z.infer<typeof FiscalYearSchema>;
