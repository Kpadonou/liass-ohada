import { AppError } from "@/lambda/shared/app-error";
import { z } from "zod";
export const InventoryScopeSchema = z
  .object({ orgId: z.string().min(1).max(100), outletId: z.string().uuid() })
  .strict();
export type InventoryScope = z.infer<typeof InventoryScopeSchema>;
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
export type StockUnit = z.infer<typeof StockUnitSchema>;
export const discreteUnit = (unit: StockUnit) =>
  ["UNIT", "BOTTLE", "CAN", "PACK"].includes(unit);
export const MilliSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const StockItemSchema = InventoryScopeSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  unit: StockUnitSchema,
  isActive: z.boolean(),
  balanceMilli: MilliSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
  .strict()
  .refine((x) => !discreteUnit(x.unit) || x.balanceMilli % 1000 === 0);
export type StockItem = z.infer<typeof StockItemSchema>;
const MovementFieldsSchema = z
  .object({
    stockItemId: z.string().uuid(),
    type: z.enum(["RECEIPT", "SALE", "LOSS", "ADJUSTMENT", "SALE_REVERSAL"]),
    quantityMilli: MilliSchema.refine((x) => x !== 0),
    businessEventId: z.string().min(1).max(200).optional(),
    sourceReference: z.string().min(1).max(200).optional(),
    actorId: z.string().min(1).max(200),
    source: z.enum(["MANUAL", "BUSINESS_EVENT"]),
  })
  .strict();
export const MovementInputSchema = MovementFieldsSchema.refine(
  (x) => x.source !== "BUSINESS_EVENT" || !!x.businessEventId,
);
export const StockMovementSchema = MovementFieldsSchema.omit({
  quantityMilli: true,
})
  .extend({
    ...InventoryScopeSchema.shape,
    id: z.string().uuid(),
    deltaMilli: MilliSchema,
    resultingBalanceMilli: MilliSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type StockMovement = z.infer<typeof StockMovementSchema>;
export function movementDelta(
  unit: StockUnit,
  input: z.infer<typeof MovementInputSchema>,
): number {
  if (discreteUnit(unit) && input.quantityMilli % 1000 !== 0)
    throw new AppError(400, "RESTAURANTS_INVENTORY_QUANTITY");
  const amount = Math.abs(input.quantityMilli);
  return input.type === "ADJUSTMENT"
    ? input.quantityMilli
    : ["SALE", "LOSS"].includes(input.type)
      ? -amount
      : amount;
}
export const StockMappingSchema = InventoryScopeSchema.extend({
  menuItemId: z.string().uuid(),
  categoryId: z.string().uuid(),
  stockItemId: z.string().uuid(),
  createdAt: z.string().datetime(),
  actorId: z.string().min(1),
}).strict();
export const InventoryReceiptSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    movement: StockMovementSchema,
  })
  .strict();
export const isNegativeStock = (item: StockItem) => item.balanceMilli < 0;
