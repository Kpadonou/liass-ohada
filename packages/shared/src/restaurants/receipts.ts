import { z } from "zod";
import { AcceptedSaleSnapshotSchema } from "./transactions";
import {
  RestaurantPaidByMethodSchema,
  RestaurantPaymentMethodSchema,
  RestaurantPaymentAllocationSchema,
} from "./payments";
const id = z.string().uuid();
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime();
export const PublishRestaurantReceiptRequestSchema = z
  .object({ clientRequestId: id })
  .strict();
export const RestaurantReceiptLineSchema = z
  .object({
    orderId: id,
    itemId: id,
    snapshot: AcceptedSaleSnapshotSchema.omit({ acceptedBy: true }),
    notes: z.string().max(1000).optional(),
    cancelledAt: time.optional(),
    cancellationReason: z.string().max(500).optional(),
    netAmountMinor: amount,
  })
  .strict();
export const RestaurantReceiptSettlementSchema = z
  .object({
    paymentId: id,
    method: RestaurantPaymentMethodSchema,
    appliedAmountMinor: amount.positive(),
    committedAt: time,
    allocations: z.array(RestaurantPaymentAllocationSchema).min(1).max(10),
    externalReference: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .optional(),
    cashTenderedMinor: amount.optional(),
    changeMinor: amount.optional(),
  })
  .strict();
export const RestaurantReceiptPartSchema = z
  .object({
    number: amount.positive(),
    previousDigest: digest,
    digest,
    content: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("COMMERCIAL"),
          lines: z.array(RestaurantReceiptLineSchema).min(1).max(16),
        })
        .strict(),
      z
        .object({
          kind: z.literal("SETTLEMENT"),
          payments: z.array(RestaurantReceiptSettlementSchema).min(1).max(16),
        })
        .strict(),
    ]),
  })
  .strict();
export const RestaurantReceiptSummarySchema = z
  .object({
    receiptId: id,
    guestSessionId: id,
    scopeKind: z.literal("GUEST_SESSION"),
    documentKind: z.literal("OPERATIONAL_RECEIPT"),
    schemaVersion: z.literal(1),
    outletName: z.string().min(1),
    restaurantName: z.string().min(1),
    tableName: z.string().min(1),
    openedAt: time,
    closedAt: time,
    currency: z.string().regex(/^[A-Z]{3}$/),
    dueMinor: amount,
    paidMinor: amount,
    paidByMethodMinor: RestaurantPaidByMethodSchema,
    partCount: amount,
    commercialPartCount: amount,
    settlementPartCount: amount,
    lineCount: amount,
    paymentCount: amount,
    digest,
    issuedAt: time,
  })
  .strict();
export const RestaurantReceiptPublicationResponseSchema = z
  .object({
    data: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("BUILDING"),
          receiptId: id,
          version: amount.positive(),
          partCount: amount,
        })
        .strict(),
      z
        .object({
          state: z.literal("FINAL"),
          receipt: RestaurantReceiptSummarySchema,
        })
        .strict(),
    ]),
  })
  .strict();
export const RestaurantReceiptReadRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(8).default(4),
    cursor: z.string().max(4000).optional(),
  })
  .strict();
export const RestaurantReceiptResponseSchema = z
  .object({
    data: RestaurantReceiptSummarySchema,
    parts: z.array(RestaurantReceiptPartSchema).max(8),
    nextCursor: z.string().optional(),
  })
  .strict();
export type RestaurantReceiptSummary = z.infer<
  typeof RestaurantReceiptSummarySchema
>;
export type RestaurantReceiptPart = z.infer<typeof RestaurantReceiptPartSchema>;
