import { z } from "zod";

export const GuestQrTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
export const GuestResolveRequestSchema = z
  .object({
    token: GuestQrTokenSchema,
    previousCapability: z.string().min(100).max(4096).optional(),
  })
  .strict();
export const GuestRenewRequestSchema = z.object({}).strict();
export const GuestCapabilitySchema = z.string().min(100).max(4096);
export const GuestVisitReferenceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);
const GuestContextFields = {
  restaurantName: z.string().min(1).max(160),
  outletName: z.string().min(1).max(160),
  tableName: z.string().min(1).max(160),
  policy: z.enum(["DISABLED", "STAFF_APPROVAL", "DIRECT"]),
  orderingPermitted: z.boolean(),
  waiterCallAvailable: z.literal(true),
  guestHandle: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  capability: GuestCapabilitySchema,
  expiresAt: z.string().datetime(),
} as const;
export const GuestContextResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("FREE"),
      visitRef: z.null(),
      ...GuestContextFields,
    })
    .strict(),
  z
    .object({
      state: z.literal("OCCUPIED"),
      visitRef: GuestVisitReferenceSchema,
      ...GuestContextFields,
    })
    .strict(),
  z
    .object({ state: z.enum(["UNAVAILABLE", "VISIT_ENDED", "EXPIRED"]) })
    .strict(),
]);
export type GuestContextResponse = z.infer<typeof GuestContextResponseSchema>;
export const ManageTableQrRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const ManagedTableQrResponseSchema = z
  .object({
    status: z.enum(["ACTIVE", "REVOKED"]),
    version: z.number().int().positive(),
    token: GuestQrTokenSchema.optional(),
  })
  .strict()
  .refine((v) => (v.status === "ACTIVE") === Boolean(v.token));
