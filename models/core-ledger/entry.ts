import { z } from "zod";

export const EntryStatus = z.enum(["DRAFT", "POSTED", "CANCELLED"]);
export const EntryType = z.enum([
  "STANDARD",
  "OPENING",
  "CLOSING",
  "ADJUSTMENT",
]);

export const EntrySchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  entryId: z.string(),
  entryType: EntryType,
  voucherNumber: z.string().optional(),
  journalCode: z.string().optional(),
  entryDate: z.string(), // ISO Date (required)
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
