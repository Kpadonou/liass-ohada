import { z } from "zod";

export const EntryStatus = z.enum(["DRAFT", "POSTED", "CANCELLED"]);

export const EntrySchema = z.object({
  orgId: z.string(),
  year: z.number(),
  entryId: z.string(),
  voucherNumber: z.string().optional(),
  journalCode: z.string(),
  entryDate: z.string(), // ISO Date
  totalDebit: z.number(),
  totalCredit: z.number(),
  status: EntryStatus,
  entityType: z.literal("ENTRY"),
  pk: z.string(),
  sk: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Entry = z.infer<typeof EntrySchema>;
