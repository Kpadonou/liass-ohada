import { z } from "zod";
import {
  RestaurantNonnegativeQuantitySchema,
  RestaurantQuantitySchema,
  restaurantQuantityToMilli,
} from "./quantity";

const id = z.string().uuid();
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quantity = RestaurantQuantitySchema;
const partNumber = z.number().int().positive();
const note = z.string().trim().min(1).max(500);
export const CreateRestaurantCreditNoteRequestSchema = z
  .object({
    clientRequestId: id,
    reason: note,
    lines: z
      .array(
        z
          .object({
            orderId: id,
            itemId: id,
            quantity,
            note: note.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.lines.map((l) => `${l.orderId}#${l.itemId}`)).size ===
      v.lines.length,
    "Duplicate source line",
  );
export const RestaurantCreditNoteSchema = z
  .object({
    creditNoteId: id,
    creditNoteReference: z.string().regex(/^AV-\d{8}-[A-F0-9]{8}$/),
    orgId: z.string().min(1).max(200),
    outletId: id,
    guestSessionId: id,
    finalBillId: id,
    sourceReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: money.positive(),
    reason: note,
    status: z.literal("VALIDATED"),
    validatedAt: z.string().datetime(),
    validatedByUserId: z.string().min(1).max(200),
    schemaVersion: z.literal(1),
    clientRequestId: id,
    intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    entityType: z.literal("RESTAURANT_CREDIT_NOTE"),
    lineCount: z.number().int().min(1).max(16),
  })
  .strict();
export const RestaurantCreditNoteLineSchema = z
  .object({
    creditNoteId: id,
    creditNoteLineId: id,
    orderId: id,
    itemId: id,
    sourcePartNumber: partNumber,
    sourcePosition: z.number().int().min(0).max(15),
    menuItemId: id,
    label: z.string().min(1).max(160),
    originalQuantity: quantity,
    creditedQuantity: quantity,
    unitAmountMinor: money,
    originalNetAmountMinor: money.positive(),
    creditedAmountMinor: money.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxMinor: money,
    discountMinor: money,
    note: note.optional(),
    schemaVersion: z.literal(1),
    entityType: z.literal("RESTAURANT_CREDIT_NOTE_LINE"),
  })
  .strict();
export const RestaurantCreditNoteDetailResponseSchema = z
  .object({
    data: RestaurantCreditNoteSchema,
    lines: z.array(RestaurantCreditNoteLineSchema).min(1).max(16),
  })
  .strict();
export const RestaurantCreditNoteListRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict();
/** Semantic availability, never persistence-control DTOs. */
export const RestaurantCreditabilityLineSchema = z
  .object({
    orderId: id,
    itemId: id,
    sourceLineIdentity: z.string().min(1),
    menuItemId: id,
    label: z.string().min(1).max(160),
    originalQuantity: quantity,
    creditedQuantity: RestaurantNonnegativeQuantitySchema,
    remainingQuantity: RestaurantNonnegativeQuantitySchema,
    unitAmountMinor: money,
    originalNetAmountMinor: money.positive(),
    creditedAmountMinor: money,
    remainingAmountMinor: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .refine(
    (v) =>
      BigInt(restaurantQuantityToMilli(v.creditedQuantity)) +
        BigInt(restaurantQuantityToMilli(v.remainingQuantity)) ===
        BigInt(restaurantQuantityToMilli(v.originalQuantity)) &&
      BigInt(v.creditedAmountMinor) + BigInt(v.remainingAmountMinor) ===
        BigInt(v.originalNetAmountMinor),
  );
export const RestaurantCreditabilitySchema = z
  .object({
    finalBillId: id,
    currency: z.string().regex(/^[A-Z]{3}$/),
    originalAmountMinor: money,
    creditedAmountMinor: money,
    remainingAmountMinor: money,
    lines: z.array(RestaurantCreditabilityLineSchema),
  })
  .strict()
  .refine(
    (v) =>
      BigInt(v.creditedAmountMinor) + BigInt(v.remainingAmountMinor) ===
      BigInt(v.originalAmountMinor),
  );
export const RestaurantCreditNoteListResponseSchema = z
  .object({
    items: z.array(RestaurantCreditNoteSchema).max(100),
    nextCursor: z.string().optional(),
    creditability: RestaurantCreditabilitySchema.optional(),
  })
  .strict();
export type RestaurantCreditNote = z.infer<typeof RestaurantCreditNoteSchema>;
export type RestaurantCreditNoteLine = z.infer<
  typeof RestaurantCreditNoteLineSchema
>;
