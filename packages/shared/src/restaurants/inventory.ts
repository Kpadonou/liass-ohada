import { z } from "zod";

export const StockUnitSchema = z.enum([
  "UNIT",
  "BOTTLE",
  "CAN",
  "PACK",
  "KG",
  "G",
  "L",
  "ML",
]);
const milli = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const InventoryListRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const CreateStockItemRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    unit: StockUnitSchema,
  })
  .strict();
export const UpdateStockItemRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: CreateStockItemRequestSchema.shape.name.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
/** Decimal text avoids binary floating-point conversion at the HTTP boundary. */
export const InventoryQuantitySchema = z
  .string()
  .regex(/^[+-]?\d{1,13}(?:\.\d{1,3})?$/);
export const ManualStockMovementRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    type: z.enum(["RECEIPT", "LOSS", "ADJUSTMENT"]),
    quantity: InventoryQuantitySchema,
    sourceReference: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const StockItemResponseDataSchema = z
  .object({
    id: z.string().uuid(),
    name: CreateStockItemRequestSchema.shape.name,
    unit: StockUnitSchema,
    isActive: z.boolean(),
    balanceMilli: milli,
    isNegativeStock: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const StockMovementResponseDataSchema = z
  .object({
    id: z.string().uuid(),
    stockItemId: z.string().uuid(),
    type: z.enum(["RECEIPT", "SALE", "LOSS", "ADJUSTMENT", "SALE_REVERSAL"]),
    deltaMilli: milli,
    resultingBalanceMilli: milli,
    isNegativeStock: z.boolean(),
    actorId: z.string(),
    source: z.enum(["MANUAL", "BUSINESS_EVENT"]),
    sourceReference: z.string().optional(),
    businessEventId: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export const StockItemResponseSchema = z
  .object({ data: StockItemResponseDataSchema })
  .strict();
export const StockItemsResponseSchema = z
  .object({
    items: z.array(StockItemResponseDataSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export const StockMovementResponseSchema = z
  .object({ data: StockMovementResponseDataSchema })
  .strict();
export const StockMovementsResponseSchema = z
  .object({
    items: z.array(StockMovementResponseDataSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export type StockItemResponseData = z.infer<typeof StockItemResponseDataSchema>;
export type StockUnit = z.infer<typeof StockUnitSchema>;
export type InventoryListRequest = z.infer<typeof InventoryListRequestSchema>;
export type CreateStockItemRequest = z.infer<
  typeof CreateStockItemRequestSchema
>;
export type UpdateStockItemRequest = z.infer<
  typeof UpdateStockItemRequestSchema
>;
export type ManualStockMovementRequest = z.infer<
  typeof ManualStockMovementRequestSchema
>;
export type StockMovementResponseData = z.infer<
  typeof StockMovementResponseDataSchema
>;
export const DirectStockUnitSchema = z.enum(["UNIT", "BOTTLE", "CAN", "PACK"]);
const trackingCommand = {
  categoryId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
};
export const SaveInventoryTrackingRequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ...trackingCommand,
      mode: z.literal("CREATE"),
      unit: DirectStockUnitSchema,
    })
    .strict(),
  z
    .object({
      ...trackingCommand,
      mode: z.literal("LINK"),
      stockItemId: z.string().uuid(),
    })
    .strict(),
]);
export const RemoveInventoryTrackingRequestSchema = z
  .object(trackingCommand)
  .strict();
export const InventoryTrackingResponseSchema = z
  .object({
    data: z
      .object({
        menuItemId: z.string().uuid(),
        version: z.number().int().nonnegative(),
        stockItem: StockItemResponseDataSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type SaveInventoryTrackingRequest = z.infer<
  typeof SaveInventoryTrackingRequestSchema
>;
export type RemoveInventoryTrackingRequest = z.infer<
  typeof RemoveInventoryTrackingRequestSchema
>;
export type InventoryTracking = z.infer<
  typeof InventoryTrackingResponseSchema
>["data"];
