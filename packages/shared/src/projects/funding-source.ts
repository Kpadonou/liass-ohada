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

export const FundingSourceDtoSchema = FundingSourceSchema.omit({
  PK: true,
  SK: true,
  entityType: true,
});

export type FundingSourceDto = z.infer<typeof FundingSourceDtoSchema>;

export const CreateFundingSourceRequestSchema = z.object({
  donorId: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3).default("XOF"),
});

export type CreateFundingSourceRequest = z.infer<
  typeof CreateFundingSourceRequestSchema
>;

export const FundingSourceResponseSchema = z.object({
  message: z.unknown().optional(),
  data: FundingSourceDtoSchema,
});

export const ListFundingSourcesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    fundingSources: z.array(FundingSourceDtoSchema),
  }),
});
