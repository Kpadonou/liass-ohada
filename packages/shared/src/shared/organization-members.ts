import { z } from "zod";
import { OrganizationAccessStatusSchema } from "./cabinet-team";

export const ListOrganizationMembersRequestSchema = z
  .object({
    limit: z
      .union([
        z.number(),
        z
          .string()
          .regex(/^[1-9]\d{0,2}$/)
          .transform(Number),
      ])
      .pipe(z.number().int().min(1).max(100))
      .default(50),
    cursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();

export const OrganizationMemberSummarySchema = z
  .object({
    userId: z.string().min(1).max(256),
    displayName: z.string().trim().min(1).max(160).optional(),
    email: z.email().optional(),
    status: OrganizationAccessStatusSchema,
  })
  .strict();

export const ListOrganizationMembersResponseSchema = z
  .object({
    items: z.array(OrganizationMemberSummarySchema).max(100),
    nextCursor: z.string().min(1).max(2048).optional(),
  })
  .strict();

export type ListOrganizationMembersRequest = z.infer<
  typeof ListOrganizationMembersRequestSchema
>;
export type OrganizationMemberSummary = z.infer<
  typeof OrganizationMemberSummarySchema
>;
export type ListOrganizationMembersResponse = z.infer<
  typeof ListOrganizationMembersResponseSchema
>;
