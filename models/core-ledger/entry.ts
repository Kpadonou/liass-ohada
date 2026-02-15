import { z } from "zod";

export const AccountingStandard = z.enum(["SYSCOHADA_GENERAL", "SYCEBNL"]);

export const EntryStatus = z.enum(["DRAFT", "POSTED", "CANCELLED"]);
export const EntryType = z.enum([
  "STANDARD",
  "OPENING",
  "CLOSING",
  "ADJUSTMENT",
]);

export const EntryLineInputSchema = z.object({
  accountId: z.string(),
  thirdPartyId: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  description: z.string().optional(),
  label: z.string().optional(),
});

export const CreateEntryRequestSchema = z.object({
  orgId: z.string().optional(), // Souvent injecté par l'authorizer
  year: z.number().int(),
  fiscalYearId: z.string().optional(),
  accountingStandard: AccountingStandard.optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().min(1).max(10),
  voucherNumber: z.string().optional(),
  entryId: z.string().optional(),
  entryType: z
    .enum(["STANDARD", "OPENING", "CLOSING", "ADJUSTMENT"])
    .default("STANDARD"),
  label: z.string().min(3).max(255),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  currency: z.string().optional(),
  lines: z.array(EntryLineInputSchema).min(2), // Minimum 2 lignes pour l'équilibre
});

export type CreateEntryRequest = z.infer<typeof CreateEntryRequestSchema>;

export const EntrySchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  entryId: z.string(),
  entryType: EntryType,
  voucherNumber: z.string().optional(),
  journalCode: z.string().optional(),
  entryDate: z.string(),
  totalDebit: z.number().int().nonnegative(), // Integer amount (smallest currency unit)
  totalCredit: z.number().int().nonnegative(), // Integer amount (smallest currency unit)
  status: EntryStatus,
  entityType: z.literal("ENTRY"),
  PK: z.string(),
  SK: z.string(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Entry = z.infer<typeof EntrySchema>;
