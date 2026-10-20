import { z } from "zod";
import {
  RestaurantOrderSchema,
  RestaurantReceiptSummarySchema,
  RestaurantReceiptPartSchema,
} from "@liass-ohada/shared/restaurants";
export const ReceiptManifestSchema = z
  .object({
    scopeKind: z.literal("GUEST_SESSION"),
    ownerId: z.string().uuid(),
    receiptId: z.string().uuid(),
    guestSessionId: z.string().uuid(),
    state: z.enum(["BUILDING", "FINAL"]),
    version: z.number().int().positive(),
    sourceVersion: z.number().int().positive(),
    financialRevision: z.number().int().nonnegative(),
    context: RestaurantReceiptSummarySchema.omit({
      partCount: true,
      commercialPartCount: true,
      settlementPartCount: true,
      lineCount: true,
      paymentCount: true,
      digest: true,
      issuedAt: true,
    }),
    orders: z.array(RestaurantOrderSchema).max(50),
    orderIndex: z.number().int().min(0).max(50),
    sourceCursor: z.string().optional(),
    phase: z.enum(["LINES", "PAYMENTS", "VERIFY", "VALIDATE"]),
    retainedCount: z.number().int().nonnegative(),
    orderAcceptedCount: z.number().int().nonnegative(),
    orderNet: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative(),
    commercialTotal: z.number().int().nonnegative(),
    partCount: z.number().int().nonnegative(),
    commercialPartCount: z.number().int().nonnegative(),
    settlementPartCount: z.number().int().nonnegative(),
    paymentCount: z.number().int().min(0).max(10000),
    paidTotal: z.number().int().nonnegative(),
    methods: z
      .object({
        CASH: z.number().int().nonnegative(),
        MOBILE_MONEY: z.number().int().nonnegative(),
        CARD: z.number().int().nonnegative(),
      })
      .strict(),
    allocations: z.record(
      z.string(),
      z
        .object({
          amount: z.number().int().nonnegative(),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    verifiedCount: z.number().int().nonnegative(),
    verifiedDigest: z.string().regex(/^[a-f0-9]{64}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    result: RestaurantReceiptSummarySchema.optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.ownerId === m.guestSessionId &&
      m.context.receiptId === m.receiptId &&
      m.context.guestSessionId === m.guestSessionId &&
      (!m.result ||
        (m.result.receiptId === m.receiptId &&
          m.result.guestSessionId === m.guestSessionId)),
    "Receipt ownership mismatch",
  );
export const ReceiptStoredSchemas = {
  MANIFEST: ReceiptManifestSchema,
  PART: RestaurantReceiptPartSchema,
  RESULT: RestaurantReceiptSummarySchema,
  COMMAND: z
    .object({
      actorId: z.string().min(1),
      fingerprint: z.string(),
      receiptId: z.string().uuid(),
    })
    .strict(),
};
export type ReceiptManifest = z.infer<typeof ReceiptManifestSchema>;
