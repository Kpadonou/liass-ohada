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

export const JournalDtoSchema = z.object({
  orgId: z.string().optional(),
  year: z.number(),
  journalCode: z.string(),
  journalName: z.string(),
  type: JournalType,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type JournalDto = z.infer<typeof JournalDtoSchema>;

export const CreateJournalRequestSchema = z.object({
  year: z.number().int(),
  journalCode: z.string().min(1).max(10),
  journalName: z.string().min(1),
  type: JournalType,
});

export type CreateJournalRequest = z.infer<typeof CreateJournalRequestSchema>;

export const JournalResponseSchema = z.object({
  message: z.unknown().optional(),
  data: JournalDtoSchema.optional(),
  journal: JournalDtoSchema.optional(),
});

export const ListJournalsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.array(JournalDtoSchema),
});
