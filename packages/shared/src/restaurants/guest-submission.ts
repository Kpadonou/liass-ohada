import { z } from "zod";
export const GuestSubmissionLineSchema = z
  .object({
    reference: z.string().min(16).max(100),
    selectionRef: z.string().min(100).max(4096),
    quantity: z.number().int().min(1).max(20),
    note: z.string().max(250),
    presentedAmountMinor: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const GuestSubmissionRequestSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    lines: z.array(GuestSubmissionLineSchema).min(1).max(12),
  })
  .strict()
  .refine(
    (v) =>
      v.lines.reduce((s, l) => s + l.quantity, 0) <= 100 &&
      new Set(v.lines.map((l) => l.reference)).size === v.lines.length,
  );
export const GuestOrderRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    state: z.enum([
      "PENDING_APPROVAL",
      "PROCESSING",
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
    ]),
    submittedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    reason: z.string().max(250).optional(),
    clientRequestId: z.string().uuid().optional(),
    mode: z.enum(["STAFF_APPROVAL", "DIRECT"]).optional(),
    orderStatus: z
      .enum(["CONFIRMED", "PREPARING", "READY", "SERVED", "CANCELLED"])
      .optional(),
    lines: z
      .array(
        z
          .object({
            name: z.string().min(1).max(160),
            quantity: z.number().int().min(1).max(20),
            note: z.string().max(250),
            fulfillment: z
              .enum(["CONFIRMED", "PREPARING", "READY", "SERVED", "CANCELLED"])
              .optional(),
            amountMinor: z.number().int().nonnegative(),
            currency: z.string().regex(/^[A-Z]{3}$/),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export const GuestSubmissionResponseSchema = z.discriminatedUnion("state", [
  z
    .object({ state: z.literal("CONFIRMED"), request: GuestOrderRequestSchema })
    .strict(),
  z
    .object({
      state: z.enum([
        "UNAVAILABLE",
        "EXPIRED",
        "VISIT_ENDED",
        "NOT_ALLOWED",
        "REVIEW_REQUIRED",
        "LIMIT_REACHED",
        "RATE_LIMITED",
      ]),
      retryAfterSeconds: z.number().int().min(1).max(5).optional(),
    })
    .strict(),
]);
export const GuestRequestStateResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("READY"),
      requests: z.array(GuestOrderRequestSchema).max(20),
    })
    .strict(),
  z
    .object({
      state: z.enum(["UNAVAILABLE", "EXPIRED", "VISIT_ENDED", "NOT_ALLOWED"]),
    })
    .strict(),
]);
export const GuestRequestReviewResponseSchema = z
  .object({ requests: z.array(GuestOrderRequestSchema).max(20) })
  .strict();
export const RejectGuestRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(250) })
  .strict();
