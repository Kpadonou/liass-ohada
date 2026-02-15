import { z } from "zod";

export const CreateEntryLineSchema = z.object({
  accountId: z.string(),
  thirdPartyId: z.string().optional(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  label: z.string().min(3).max(255).optional(), // Optionnel ici : si absent, prend celui de l'entête
});

export const EntryLineSchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  lineId: z.string(),
  entryId: z.string(),
  accountId: z.string().regex(/^\d{8}$/, "Account ID must be exactly 8 digits"),
  projectId: z.string().optional(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  label: z.string().min(3).max(255).optional(), // Optionnel ici : si absent, prend celui de l'entête
  description: z.string().optional(),
  entryDate: z.string(),
  thirdPartyId: z.string().optional(),
  voucherNumber: z.string().optional(),
  journalCode: z.string(),
  letteringCode: z.string().optional(),
  entityType: z.literal("ENTRY_LINE"),
  PK: z.string(),
  SK: z.string(),
  GSI1PK: z.string(),
  GSI1SK: z.string(), // ACC#account#date#id
  GSI2PK: z.string().optional(),
  GSI2SK: z.string().optional(),
  L_PK: z.string().optional(),
  L_SK: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EntryLine = z.infer<typeof EntryLineSchema>;
