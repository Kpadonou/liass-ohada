import { z } from "zod";

/**
 * Zod schema for a Donor entity in the SYCEBNL context.
 * A donor is a funding partner linked to specific projects.
 */
export const DonorSchema = z.object({
  orgId: z.string(),
  donorId: z.string(), // Technical ID
  code: z.string().min(2).max(10).toUpperCase(), // Short identifier (ex: "USAID")
  name: z.string().min(3),
  type: z.enum(["PUBLIC", "PRIVATE", "GOVERNMENT", "INDIVIDUAL", "OTHER"]),
  currency: z.string().length(3).default("XOF"),
  entityType: z.literal("DONOR").default("DONOR"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  // Link to the 8-digit general ledger account (e.g., 41110001)
  associatedAccountId: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Donor = z.infer<typeof DonorSchema>;

export const DonorDtoSchema = DonorSchema.omit({
  entityType: true,
});

export type DonorDto = z.infer<typeof DonorDtoSchema>;

export const CreateDonorRequestSchema = z.object({
  code: z.string().min(2).max(10),
  name: z.string().min(3),
  type: z.enum(["PUBLIC", "PRIVATE", "GOVERNMENT", "INDIVIDUAL", "OTHER"]),
  currency: z.string().length(3).default("XOF"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  associatedAccountId: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

export type CreateDonorRequest = z.infer<typeof CreateDonorRequestSchema>;

export const DonorResponseSchema = z.object({
  message: z.unknown().optional(),
  data: DonorDtoSchema,
});

export const ListDonorsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    donors: z.array(DonorDtoSchema),
  }),
});
