import { z } from "zod";

export const EntryLineSchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  lineId: z.string(),
  entryId: z.string(),
  accountId: z.string(),
  projectId: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  description: z.string().optional(),
  entryDate: z.string(),
  thirdPartyId: z.string().optional(),
  voucherNumber: z.string().optional(),
  journalCode: z.string(),
  matchId: z.string().optional(),
  entityType: z.literal("ENTRY_LINE"),
  pk: z.string(),
  sk: z.string(),

  // Indexation GSI (Obligatoires pour la cohérence comptable)
  gsi1sk: z.string(), // ACC#account#date#id
  gsi2sk: z.string().optional(), // TP#thirdparty#date
  gsi3sk: z.string(), // JRN#journal#date#id

  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EntryLine = z.infer<typeof EntryLineSchema>;
