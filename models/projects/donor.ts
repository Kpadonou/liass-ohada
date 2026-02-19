import { z } from "zod";

/**
 * Zod schema for a Donor entity in the SYCEBNL context.
 * A donor is a funding partner linked to specific projects.
 */
export const DonorSchema = z.object({
  orgId: z.string(),
  donorId: z.string(), // Technical ID
  code: z.string().min(2).max(10).toUpperCase(), // Short identifier (ex: "USAID")
  name: z.string().min(3).max(100),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  associatedAccountId: z
    .string()
    .regex(/^\d{8}$/)
    .optional(), // Link to general ledger account
  entityType: z.literal("DONOR"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Donor = z.infer<typeof DonorSchema>;
