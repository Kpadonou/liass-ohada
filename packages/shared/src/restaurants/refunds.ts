import { z } from "zod";
import { RestaurantPaymentMethodSchema } from "./payments";

const id = z.string().uuid();
const actor = z.string().min(1).max(200);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const RestaurantRefundExternalReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const CreateRestaurantRefundRequestSchema = z
  .object({
    clientRequestId: id,
    amountMinor: money.positive(),
    method: RestaurantPaymentMethodSchema,
    externalReference: RestaurantRefundExternalReferenceSchema.optional(),
  })
  .strict();
export const RestaurantRefundSchema = z
  .object({
    refundId: id,
    refundReference: z.string().regex(/^REF-\d{8}-[A-F0-9]{8}$/),
    creditNoteId: id,
    guestSessionId: id,
    finalBillId: id,
    orgId: actor,
    outletId: id,
    amountMinor: money.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    method: RestaurantPaymentMethodSchema,
    status: z.literal("CONFIRMED"),
    refundedAt: z.string().datetime(),
    refundedByUserId: actor,
    businessDayId: id,
    cashSessionId: id,
    externalReference: RestaurantRefundExternalReferenceSchema.optional(),
    schemaVersion: z.literal(1),
    clientRequestId: id,
    intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    entityType: z.literal("RESTAURANT_REFUND"),
  })
  .strict();
export const RestaurantRefundResponseSchema = z
  .object({ data: RestaurantRefundSchema })
  .strict();
export const RestaurantRefundListRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict();
export const RestaurantRefundListResponseSchema = z
  .object({
    items: z.array(RestaurantRefundSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export type RestaurantRefund = z.infer<typeof RestaurantRefundSchema>;
