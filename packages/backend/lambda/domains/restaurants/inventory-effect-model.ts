import { z } from "zod";
import { InventoryScopeSchema } from "./inventory-model";
import { transactionFingerprint } from "./transaction-repository";

export const InventoryEffectReferenceSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z
      .string()
      .datetime()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  })
  .strict();
export type InventoryEffectReference = z.infer<
  typeof InventoryEffectReferenceSchema
>;
const state = z.enum(["PENDING", "RETRYABLE", "FAILED", "APPLIED"]);
export const InventoryEffectErrorSchema = z.enum([
  "TRANSIENT_FAILURE",
  "INVENTORY_CONFLICT",
  "STOCK_ITEM_MISSING",
  "INVALID_STOCK_UNIT",
  "INVALID_QUANTITY",
  "INVALID_EFFECT",
  "DEPENDENCY_PENDING",
  "DEPENDENCY_FAILED",
]);
export type InventoryEffectError = z.infer<typeof InventoryEffectErrorSchema>;
export const InventoryEffectTargetSchema = z
  .object({
    stockItemId: z.string().uuid(),
    // An exact integer string also retains otherwise valid commercial quantities beyond the current balance range.
    quantityMilli: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(32),
    businessEventId: z.string().min(1).max(200),
    originalBusinessEventIds: z
      .array(z.string().min(1).max(200))
      .max(200)
      .optional(),
    state,
    movementId: z.string().uuid().optional(),
    lastErrorCode: InventoryEffectErrorSchema.optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.state === "APPLIED" && !target.movementId)
      ctx.addIssue({
        code: "custom",
        message: "Applied target requires its movement reference",
      });
  });
const envelope = InventoryScopeSchema.extend({
  ...InventoryEffectReferenceSchema.shape,
  version: z.number().int().positive(),
  type: z.enum(["SALE", "SALE_REVERSAL"]),
  source: z
    .object({
      kind: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
      reference: z.string().min(1).max(200),
      orderId: z.string().uuid().optional(),
      submissionId: z.string().uuid().optional(),
    })
    .strict(),
  actorId: z.string().min(1).max(200),
  dependencies: z.array(InventoryEffectReferenceSchema).max(200),
  state,
  attemptCount: z.number().int().nonnegative(),
  lastAttemptAt: z.string().datetime().optional(),
  lastErrorCode: InventoryEffectErrorSchema.optional(),
  updatedAt: z.string().datetime(),
  appliedAt: z.string().datetime().optional(),
}).strict();
export const InventoryEffectSchema = envelope
  .extend({ targets: z.array(InventoryEffectTargetSchema).min(1).max(200) })
  .strict()
  .superRefine((effect, ctx) => {
    if (
      effect.state === "APPLIED" &&
      (!effect.appliedAt || effect.targets.some((t) => t.state !== "APPLIED"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Applied effect requires all durable target results",
      });
  });
/** Decode the operational envelope even if payload corruption needs to be durably quarantined. */
export const StoredInventoryEffectSchema = envelope
  .extend({ targets: z.array(z.unknown()).max(200) })
  .strict();
export type InventoryEffect = z.infer<typeof InventoryEffectSchema>;
export type StoredInventoryEffect = z.infer<typeof StoredInventoryEffectSchema>;

/** Preserve the accepted SALE and SALE_REVERSAL business identities exactly. */
export function inventorySaleEventId(
  scope: { orgId: string; outletId: string },
  orderId: string,
  submissionId: string,
  stockItemId: string,
  type = "SALE",
) {
  return (
    "INVENTORY_" +
    type +
    ":" +
    transactionFingerprint([
      scope.orgId,
      scope.outletId,
      orderId,
      submissionId,
      stockItemId,
    ])
  );
}
