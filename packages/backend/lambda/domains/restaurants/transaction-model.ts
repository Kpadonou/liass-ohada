import { z } from "zod";
import {
  GuestSessionSchema,
  RestaurantOrderSchema,
  RestaurantOrderItemSchema,
  RestaurantPreparationSchema,
} from "@liass-ohada/shared/restaurants";

const id = z.string().uuid();
const base = {
  PK: z.string(),
  SK: z.string(),
  orgId: z.string().min(1),
  outletId: id,
  schemaVersion: z.literal(1),
};
const locator = z
  .object({
    targetId: id,
    targetKind: z.enum(["SESSION", "ORDER"]),
    timestamp: z.string().datetime(),
    guestSessionId: id.optional(),
    tableId: id.optional(),
  })
  .strict();
const audit = z
  .object({
    commandId: id,
    actorId: z.string().min(1),
    action: z.string().min(1),
    targetId: id,
    committedAt: z.string().datetime(),
    version: z.number().int().positive(),
    fromState: z.string().optional(),
    toState: z.string(),
    reason: z.string().max(500).optional(),
    preparation: z
      .object({ itemId: id, fireId: id, stationId: id, submissionId: id })
      .strict()
      .optional(),
    responsibility: z
      .object({
        tableId: id,
        before: z.string().nullable(),
        after: z.string().nullable(),
        beforeDisplayName: z.string().nullable(),
        afterDisplayName: z.string().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const TransactionSchemas = {
  PREPARATION: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_PREPARATION"),
      data: RestaurantPreparationSchema,
    })
    .strict(),
  WORK: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_PREPARATION_WORK"),
      data: z
        .object({
          orderId: id,
          itemId: id,
          fireId: id,
          stationId: id,
          state: z.enum(["QUEUED", "IN_PROGRESS", "READY"]),
          queuedAt: z.string().datetime(),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  PREPARATION_COMMAND: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_PREPARATION_COMMAND"),
      data: z
        .object({
          commandId: id,
          commandKind: z.string().min(1),
          ownerId: id,
          lookupHash: z.string().regex(/^[a-f0-9]{64}$/),
          committedAt: z.string().datetime(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          result: RestaurantPreparationSchema,
        })
        .strict(),
    })
    .strict(),
  SESSION: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_GUEST_SESSION"),
      data: GuestSessionSchema.refine(
        (v) =>
          v.openOrderCount <= v.orderCount &&
          v.orderCount <= 50 &&
          BigInt(v.dueMinor) >= BigInt(v.paidMinor) + BigInt(v.reservedMinor) &&
          (v.status !== "CLOSED" ||
            Boolean(
              v.closedAt &&
              v.closedBy &&
              !v.openOrderCount &&
              v.dueMinor === v.paidMinor &&
              !v.reservedMinor &&
              !v.pendingPaymentCount,
            )),
        { message: "Inconsistent visit state" },
      ),
    })
    .strict(),
  ORDER: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_ORDER"),
      data: RestaurantOrderSchema.refine(
        (v) =>
          v.acceptedLineCount + v.draftLineCount <= v.lineCount &&
          BigInt(v.dueMinor) >= BigInt(v.paidMinor) + BigInt(v.reservedMinor) &&
          (v.orderType === "DINE_IN") ===
            Boolean(v.guestSessionId && v.tableId) &&
          (v.orderType === "DINE_IN" || (!v.guestSessionId && !v.tableId)),
        { message: "Inconsistent order state" },
      ),
    })
    .strict(),
  LINE: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_ORDER_ITEM"),
      data: RestaurantOrderItemSchema.refine(
        (v) =>
          (v.status !== "ACCEPTED" || Boolean(v.snapshot)) &&
          (v.status !== "DRAFT" || !v.snapshot) &&
          (!v.snapshot ||
            (v.snapshot.menuItemId === v.menuItemId &&
              v.snapshot.categoryId === v.categoryId &&
              v.snapshot.quantity === v.quantity)),
        { message: "Inconsistent sale snapshot" },
      ),
    })
    .strict(),
  SUBMISSION: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_SUBMISSION"),
      data: z
        .object({
          orderId: id,
          submissionId: id,
          count: z.number().int().min(1).max(12),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          actorId: z.string().min(1),
          committedAt: z.string().datetime(),
        })
        .strict(),
    })
    .strict(),
  OCCUPANCY: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_TABLE_OCCUPANCY"),
      data: z.object({ guestSessionId: id, tableId: id, areaId: id }).strict(),
    })
    .strict(),
  ACTIVE_SESSION: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_ACTIVE_SESSION"),
      data: locator,
    })
    .strict(),
  ACTIVE_ORDER: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_ACTIVE_ORDER"),
      data: locator,
    })
    .strict(),
  UNPAID: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_UNPAID_ORDER"),
      data: locator,
    })
    .strict(),
  WAITER: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_WAITER_ORDER"),
      data: locator.extend({ waiterId: z.string().min(1) }).strict(),
    })
    .strict(),
  SESSION_ORDER: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_SESSION_ORDER"),
      data: locator
        .extend({ guestSessionId: id, targetKind: z.literal("ORDER") })
        .strict(),
    })
    .strict(),
  OPEN_SESSION_ORDER: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_OPEN_SESSION_ORDER"),
      data: locator
        .extend({ guestSessionId: id, targetKind: z.literal("ORDER") })
        .strict(),
    })
    .strict(),
  SESSION_HISTORY: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_SESSION_HISTORY"),
      data: locator,
    })
    .strict(),
  TABLE_SESSION_HISTORY: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_TABLE_SESSION_HISTORY"),
      data: locator,
    })
    .strict(),
  ORDER_HISTORY: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_ORDER_HISTORY"),
      data: locator,
    })
    .strict(),
  AUDIT: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_TRANSACTION_AUDIT"),
      data: audit,
    })
    .strict(),
  ACTIVITY: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_TRANSACTION_ACTIVITY"),
      data: audit,
    })
    .strict(),
  COMMAND: z
    .object({
      ...base,
      entityType: z.literal("RESTAURANT_TRANSACTION_COMMAND"),
      data: z
        .object({
          commandId: id,
          commandKind: z.string().min(1),
          ownerId: z.string().min(1),
          lookupHash: z.string().regex(/^[a-f0-9]{64}$/),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          committedAt: z.string().datetime(),
          result: z.union([
            GuestSessionSchema,
            RestaurantOrderSchema,
            RestaurantOrderItemSchema,
          ]),
        })
        .strict(),
    })
    .strict(),
} as const;
export type TransactionKind = keyof typeof TransactionSchemas;
export type TransactionRow = z.infer<
  (typeof TransactionSchemas)[TransactionKind]
>;
export type TransactionData = TransactionRow["data"];
export interface TransactionScope {
  orgId: string;
  outletId: string;
}
export interface TransactionKey {
  PK: string;
  SK: string;
}
