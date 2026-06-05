import { z } from "zod";

export const FiscalYearStatus = z.enum([
  "OPEN",
  "LOCKED",
  "CLOSED",
  "ARCHIVED",
]);
export const AccountingFramework = z.enum(["SYSCOHADA_REVISED", "SYCEBNL"]);

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
