import { z } from "zod";

export const FundingSourceSchema = z.object({
  PK: z.string(), // ORG#{orgId}
  SK: z.string(), // PRJ#{projectId}#FS#{donorId}
  entityType: z.literal("FUNDING_SOURCE"),
  projectId: z.string(),
  donorId: z.string(), // ex: "UNICEF", "WB", "AFD"
  label: z.string(), // ex: "Financement Équipement UNICEF 2026"
  amount: z.number().int().nonnegative(), // Montant total alloué par ce bailleur
  currency: z.string().default("XOF"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FundingSource = z.infer<typeof FundingSourceSchema>;
