import { z } from "zod";

export const EntryLineSchema = z.object({
  orgId: z.string(),
  year: z.number(),
  lineId: z.string(),
  entryId: z.string(),
  accountId: z.string(), // 8-digit
  projectId: z.string().optional(),
  debit: z.number(),
  credit: z.number(),
  description: z.string(),
  entryDate: z.string(), // ISO Date
  thirdPartyId: z.string().optional(),
  voucherNumber: z.string().optional(),
  journalCode: z.string(),
  matchId: z.string().optional(),
  entityType: z.literal("ENTRY_LINE"),
  pk: z.string(),
  sk: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EntryLine = z.infer<typeof EntryLineSchema>;
