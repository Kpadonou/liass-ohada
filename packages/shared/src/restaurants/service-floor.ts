import { z } from "zod";

const id = z.string().uuid();
export const RestaurantServiceFloorRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(4000).optional(),
  })
  .strict();
const table = {
  tableId: id,
  code: z.string().min(1),
  name: z.string().min(1).optional(),
  areaId: id,
  areaName: z.string().min(1).optional(),
  capacity: z.number().int().positive().optional(),
};
export const RestaurantServiceFloorTableSchema = z.discriminatedUnion("state", [
  z.object({ ...table, state: z.literal("FREE") }).strict(),
  z
    .object({
      ...table,
      state: z.literal("OCCUPIED"),
      guestSessionId: id,
      openedAt: z.string().datetime(),
      openedBy: z.string().min(1),
      currentAmountMinor: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
      // Total orders ever created in this session, including drafts/terminal orders.
      // Optional for compatibility with older Service Floor responses.
      orderCount: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
]);
export const RestaurantServiceFloorResponseSchema = z
  .object({
    outletId: id,
    items: z.array(RestaurantServiceFloorTableSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export type RestaurantServiceFloorResponse = z.infer<
  typeof RestaurantServiceFloorResponseSchema
>;
