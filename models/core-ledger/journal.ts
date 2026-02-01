import { z } from "zod";

export const JournalType = z.enum(["PURCHASE", "SALE", "BANK", "MISC"]);

export const JournalSchema = z.object({
  orgId: z.string(),
  year: z.number(),
  journalCode: z.string(),
  journalName: z.string(),
  type: JournalType,
  entityType: z.literal("JOURNAL"),
  PK: z.string(),
  SK: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Journal = z.infer<typeof JournalSchema>;
