import { z } from "zod";

export const EntryLineSchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  lineId: z.string(),
  entryId: z.string(),
  accountId: z.string(), // 8-digit
  projectId: z.string().optional(),
  debit: z.number().int().nonnegative(), // Integer amount (smallest currency unit)
  credit: z.number().int().nonnegative(), // Integer amount (smallest currency unit)
  description: z.string().optional(),
  entryDate: z.string().optional(), // ISO Date
  thirdPartyId: z.string().optional(),
  voucherNumber: z.string().optional(),
  journalCode: z.string().optional(),
  matchId: z.string().optional(),
  entityType: z.literal("ENTRY_LINE"),
  pk: z.string(),
  sk: z.string(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EntryLine = z.infer<typeof EntryLineSchema>;
