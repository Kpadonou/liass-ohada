import { z } from "zod";
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const common = {
  orgId: z.string().min(1),
  outletId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  guestSessionId: z.string().uuid(),
  businessDayId: z.string().uuid().nullable(),
  tableDisplayName: z.string().min(1).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
};
export const RestaurantInvoiceCollectionRowSchema = z
  .object({
    ...common,
    issuedAt: z.string().datetime(),
    totalMinor: money,
    status: z.literal("FINAL"),
  })
  .strict();
export const RestaurantCreditNoteCollectionRowSchema = z
  .object({
    ...common,
    creditNoteId: z.string().uuid(),
    creditNoteReference: z.string().regex(/^AV-\d{8}-[A-F0-9]{8}$/),
    validatedAt: z.string().datetime(),
    reason: z.string().min(1).max(500),
    amountMinor: money.positive(),
    refundedMinor: money,
    remainingRefundableMinor: money,
    status: z.literal("VALIDATED"),
  })
  .strict()
  .refine(
    (v) => v.refundedMinor + v.remainingRefundableMinor === v.amountMinor,
  );
export const RestaurantDocumentCollectionRequestSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    businessDayId: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
    cursor: z.string().max(4000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) >= Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
    "Maximum range is 31 days",
  );
export const RestaurantInvoiceCollectionResponseSchema = z
  .object({
    items: z.array(RestaurantInvoiceCollectionRowSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantCreditNoteCollectionResponseSchema = z
  .object({
    items: z.array(RestaurantCreditNoteCollectionRowSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
