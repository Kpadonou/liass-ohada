import { z } from "zod";
import { RestaurantsRoleSchema } from "../shared/restaurants-access";

/** Platform user reference, not a provider username or a new staff identity. */
export const RestaurantStaffUserIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const RestaurantStaffStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export const RestaurantStaffLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      !value.includes("@") &&
      !/[\u0000-\u001f\u007f]/.test(value) &&
      !z.string().uuid().safeParse(value).success,
  );
const metadata = {
  userId: RestaurantStaffUserIdSchema,
  status: RestaurantStaffStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const RestaurantStaffSchema = z
  .object({
    ...metadata,
    operationalLabel: RestaurantStaffLabelSchema.optional(),
    displayName: z.string().min(1).max(160).nullable(),
    restaurantRole: RestaurantsRoleSchema.nullable(),
    organizationMembershipActive: z.boolean(),
  })
  .strict();
export const RestaurantStaffOutletSchema = z
  .object({
    ...metadata,
    outletId: z.string().uuid(),
  })
  .strict();
export const BindRestaurantStaffRequestSchema = z
  .object({
    memberUserId: RestaurantStaffUserIdSchema,
    operationalLabel: RestaurantStaffLabelSchema.optional(),
    clientRequestId: z.string().uuid(),
  })
  .strict();
export const UpdateRestaurantStaffRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    expectedVersion: metadata.version,
    status: RestaurantStaffStatusSchema.optional(),
    operationalLabel: RestaurantStaffLabelSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined || value.operationalLabel !== undefined,
  );
export const AssignRestaurantStaffOutletRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    // Omit for initial assignment; required to reactivate a retained assignment.
    expectedVersion: metadata.version.optional(),
  })
  .strict();
export const UnassignRestaurantStaffOutletRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    expectedVersion: metadata.version,
  })
  .strict();
export const RestaurantStaffResponseSchema = z
  .object({ data: RestaurantStaffSchema })
  .strict();
export const RestaurantStaffOutletResponseSchema = z
  .object({ data: RestaurantStaffOutletSchema })
  .strict();
export const RestaurantStaffListResponseSchema = z
  .object({
    items: z.array(RestaurantStaffSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantStaffOutletListResponseSchema = z
  .object({
    items: z.array(RestaurantStaffOutletSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantOutletStaffListResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            staff: RestaurantStaffSchema,
            assignment: RestaurantStaffOutletSchema,
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export type RestaurantStaff = z.infer<typeof RestaurantStaffSchema>;
export type RestaurantStaffOutlet = z.infer<typeof RestaurantStaffOutletSchema>;
