import { z } from "zod";
export const GuestWaiterCallRequestSchema = z.object({}).strict();
export const GuestWaiterCallResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("REQUESTED"),
      requestedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      state: z.literal("ACKNOWLEDGED"),
      requestedAt: z.string().datetime(),
      acknowledgedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      state: z.literal("COOLDOWN"),
      retryAfterSeconds: z.number().int().min(1).max(60),
    })
    .strict(),
  z
    .object({ state: z.enum(["UNAVAILABLE", "EXPIRED", "VISIT_ENDED"]) })
    .strict(),
]);
export const WaiterCallActivitySchema = z
  .object({
    waiterCallId: z.string().uuid(),
    tableId: z.string().uuid(),
    tableName: z.string().min(1).max(160),
    requestedAt: z.string().datetime(),
    operationalExpiresAt: z.string().datetime(),
    hasSession: z.boolean(),
  })
  .strict();
export const GuestActivityResponseSchema = z
  .object({
    items: z.array(WaiterCallActivitySchema).max(100),
    preServiceRequests: z
      .array(
        z
          .object({
            requestId: z.string().uuid(),
            tableId: z.string().uuid(),
            tableName: z.string().min(1).max(160),
            requestedAt: z.string().datetime(),
            operationalExpiresAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    nextCursor: z.string().max(2000).optional(),
  })
  .strict();
export const AcknowledgeWaiterCallResponseSchema = z
  .object({
    waiterCallId: z.string().uuid(),
    state: z.literal("ACKNOWLEDGED"),
    acknowledgedAt: z.string().datetime(),
  })
  .strict();
