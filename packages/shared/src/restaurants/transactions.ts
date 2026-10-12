import { z } from "zod";
const id = z.string().uuid();
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[A-Z]{3}$/);
const timestamp = z.string().datetime();
const owner = {
  orgId: z.string().min(1),
  outletId: id,
  schemaVersion: z.literal(1),
};
const balance = {
  dueMinor: money,
  paidMinor: money,
  reservedMinor: money,
  pendingPaymentCount: count,
};
export const GuestSessionSchema = z
  .object({
    ...owner,
    ...balance,
    guestSessionId: id,
    tableId: id,
    areaId: id,
    tableCode: z.string().min(1),
    tableName: z.string().min(1),
    currency,
    partySize: z.number().int().positive().max(1000).optional(),
    status: z.enum(["OPEN", "CLOSED"]),
    openedAt: timestamp,
    openedBy: z.string().min(1),
    closedAt: timestamp.optional(),
    closedBy: z.string().min(1).optional(),
    version,
    financialRevision: count,
    orderCount: count,
    openOrderCount: count,
  })
  .strict();
export const RestaurantOrderSchema = z
  .object({
    ...owner,
    ...balance,
    orderId: id,
    guestSessionId: id.optional(),
    tableId: id.optional(),
    orderType: z.enum(["DINE_IN", "TAKEAWAY", "COUNTER"]),
    status: z.enum(["DRAFT", "SUBMITTED", "CLOSED", "CANCELLED"]),
    currency,
    createdAt: timestamp,
    createdBy: z.string().min(1),
    closedAt: timestamp.optional(),
    closedBy: z.string().min(1).optional(),
    waiterId: z.string().min(1).optional(),
    version,
    financialRevision: count,
    lineCount: count.max(200),
    acceptedLineCount: count.max(200),
    draftLineCount: count.max(200),
  })
  .strict();
export const AcceptedSaleSnapshotSchema = z
  .object({
    menuItemId: id,
    menuId: id,
    categoryId: id,
    itemVersion: version,
    categoryVersion: version,
    menuVersion: version,
    name: z.string().min(1).max(160),
    stationId: id.optional(),
    stationVersion: version.optional(),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unitPriceMinor: money,
    grossMinor: money,
    subtotalMinor: money,
    discountMinor: z.literal(0),
    taxMinor: z.literal(0),
    lineTotalMinor: money,
    currency,
    acceptedAt: timestamp,
    acceptedBy: z.string().min(1),
    submissionId: id,
  })
  .strict();
export const RestaurantOrderItemSchema = z
  .object({
    ...owner,
    orderId: id,
    itemId: id,
    menuItemId: id,
    categoryId: id,
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    notes: z.string().max(1000).optional(),
    expectedMenuItemVersion: version,
    version,
    status: z.enum(["DRAFT", "ACCEPTED", "CANCELLED"]),
    createdAt: timestamp,
    snapshot: AcceptedSaleSnapshotSchema.optional(),
    cancelledAt: timestamp.optional(),
    cancelledBy: z.string().min(1).optional(),
    cancellationReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const intent = { clientRequestId: id };
const edit = { ...intent, expectedVersion: version };
export const OpenGuestSessionRequestSchema = z
  .object({
    ...intent,
    tableId: id,
    areaId: id,
    partySize: z.number().int().positive().max(1000).optional(),
  })
  .strict();
export const CloseGuestSessionRequestSchema = z.object(edit).strict();
export const CreateRestaurantOrderRequestSchema = z
  .object({
    ...intent,
    orderType: RestaurantOrderSchema.shape.orderType,
    guestSessionId: id.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.orderType === "DINE_IN") !== Boolean(value.guestSessionId))
      ctx.addIssue({
        code: "custom",
        path: ["guestSessionId"],
        message: "Dine-in requires a session; standalone modes omit it",
      });
  });
const draft = {
  menuItemId: id,
  categoryId: id,
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  notes: z.string().max(1000).optional(),
  expectedMenuItemVersion: version,
};
export const AddRestaurantDraftItemRequestSchema = z
  .object({ ...edit, ...draft })
  .strict();
export const EditRestaurantDraftItemRequestSchema = z
  .object({ ...edit, ...draft, expectedItemVersion: version })
  .strict();
export const CancelRestaurantItemRequestSchema = z
  .object({
    ...edit,
    expectedItemVersion: version,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const SubmitRestaurantOrderRequestSchema = z
  .object({
    ...edit,
    items: z
      .array(z.object({ itemId: id, expectedVersion: version }).strict())
      .min(1)
      .max(12),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.itemId)).size === v.items.length,
    { message: "Duplicate item" },
  );
export const CancelRestaurantOrderRequestSchema = z
  .object({ ...edit, reason: z.string().trim().min(1).max(500) })
  .strict();
export const CloseRestaurantOrderRequestSchema = z.object(edit).strict();
export const RestaurantTransactionListRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(4000).optional(),
  })
  .strict();
export const RestaurantTransactionHistoryRequestSchema =
  RestaurantTransactionListRequestSchema.extend({
    start: timestamp,
    end: timestamp,
    direction: z.enum(["ASC", "DESC"]).default("ASC"),
  })
    .strict()
    .refine((v) => v.start < v.end, { message: "Invalid UTC interval" });
export const GuestSessionResponseSchema = z
  .object({ data: GuestSessionSchema })
  .strict();
export const RestaurantOrderResponseSchema = z
  .object({ data: RestaurantOrderSchema })
  .strict();
export const RestaurantOrderItemResponseSchema = z
  .object({ data: RestaurantOrderItemSchema })
  .strict();
export const GuestSessionListResponseSchema = z
  .object({
    items: z.array(GuestSessionSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantOrderListResponseSchema = z
  .object({
    items: z.array(RestaurantOrderSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantOrderItemListResponseSchema = z
  .object({
    items: z.array(RestaurantOrderItemSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export const ActiveTableGuestSessionResponseSchema = z
  .object({ data: GuestSessionSchema.nullable() })
  .strict();
export type GuestSession = z.infer<typeof GuestSessionSchema>;
export type RestaurantOrder = z.infer<typeof RestaurantOrderSchema>;
export type RestaurantOrderItem = z.infer<typeof RestaurantOrderItemSchema>;
