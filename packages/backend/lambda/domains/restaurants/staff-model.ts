import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";

export const StaffRecordSchema = c.RestaurantStaffSchema.omit({
  displayName: true,
  restaurantRole: true,
  organizationMembershipActive: true,
});
export type StaffRecord = z.infer<typeof StaffRecordSchema>;
export const StaffDataSchemas = {
  STAFF: StaffRecordSchema,
  ASSIGNMENT: c.RestaurantStaffOutletSchema,
  COMMAND: z
    .object({
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      result: z.union([StaffRecordSchema, c.RestaurantStaffOutletSchema]),
    })
    .strict(),
  AUDIT: z
    .object({
      actorId: c.RestaurantStaffUserIdSchema,
      userId: c.RestaurantStaffUserIdSchema,
      outletId: z.string().uuid().optional(),
      action: z.enum(["BIND", "UPDATE", "ASSIGN", "UNASSIGN"]),
      timestamp: z.string().datetime(),
      before: z
        .union([StaffRecordSchema, c.RestaurantStaffOutletSchema])
        .nullable(),
      after: z.union([StaffRecordSchema, c.RestaurantStaffOutletSchema]),
    })
    .strict(),
};
export type StaffKind = keyof typeof StaffDataSchemas;
export const StaffRowSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().min(1),
    orgId: z.string().min(1),
    entityType: z.enum([
      "RESTAURANT_STAFF",
      "RESTAURANT_STAFF_ASSIGNMENT",
      "RESTAURANT_STAFF_COMMAND",
      "RESTAURANT_STAFF_AUDIT",
    ]),
    schemaVersion: z.literal(1),
    data: z.unknown(),
  })
  .strict();
export const staffEntityTypes = {
  STAFF: "RESTAURANT_STAFF",
  ASSIGNMENT: "RESTAURANT_STAFF_ASSIGNMENT",
  COMMAND: "RESTAURANT_STAFF_COMMAND",
  AUDIT: "RESTAURANT_STAFF_AUDIT",
} as const;
export type StaffKey = { PK: string; SK: string };
