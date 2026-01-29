import { z } from "zod";

export const EntryStatus = z.enum(["DRAFT", "POSTED", "CANCELLED"]);

export const EntrySchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  entryId: z.string(),
  voucherNumber: z.string().optional(),
  journalCode: z.string().optional(),
  entryDate: z.string().optional(), // ISO Date
  totalDebit: z.number().int().nonnegative(), // Integer amount (smallest currency unit)
  totalCredit: z.number().int().nonnegative(), // Integer amount (smallest currency unit)
  status: EntryStatus,
  entityType: z.literal("ENTRY"),
  pk: z.string(),
  sk: z.string(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Entry = z.infer<typeof EntrySchema>;
