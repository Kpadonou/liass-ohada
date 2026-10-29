import { z } from "zod";
const id = z.string().uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = count.positive();
const version = positive;
const currency = z.string().regex(/^[A-Z]{3}$/);
export const RestaurantPaymentMethodSchema = z.enum([
  "CASH",
  "MOBILE_MONEY",
  "CARD",
]);
export const RestaurantPaidByMethodSchema = z
  .object({ CASH: count, MOBILE_MONEY: count, CARD: count })
  .strict();
export const RestaurantPaymentAllocationSchema = z
  .object({ orderId: id, amountMinor: positive })
  .strict();
const allocations = z
  .array(RestaurantPaymentAllocationSchema)
  .min(1)
  .max(10)
  .refine(
    (rows) => new Set(rows.map((row) => row.orderId)).size === rows.length,
    "Duplicate Order allocation",
  );
export const CaptureRestaurantPaymentRequestSchema = z
  .object({
    clientRequestId: id,
    expectedVersion: version,
    method: RestaurantPaymentMethodSchema,
    currency,
    allocations,
    cashTenderedMinor: positive.optional(),
    externalReference: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const total = value.allocations.reduce(
      (sum, row) => sum + BigInt(row.amountMinor),
      0n,
    );
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Unsafe allocation sum",
      });
    if (value.method !== "CASH" && value.cashTenderedMinor !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["cashTenderedMinor"],
        message: "Cash evidence requires CASH",
      });
    if (
      value.cashTenderedMinor !== undefined &&
      BigInt(value.cashTenderedMinor) < total
    )
      ctx.addIssue({
        code: "custom",
        path: ["cashTenderedMinor"],
        message: "Tender below applied amount",
      });
  });
export const RestaurantPaymentSchema = z
  .object({
    orgId: z.string().min(1),
    outletId: id,
    schemaVersion: z.literal(1),
    paymentId: id,
    guestSessionId: id,
    status: z.literal("SUCCEEDED"),
    version,
    method: RestaurantPaymentMethodSchema,
    currency,
    appliedAmountMinor: positive,
    clientRequestId: id,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    actorId: z.string().min(1),
    capturedByUserId: z.string().min(1).optional(),
    businessDayId: id.optional(),
    cashSessionId: id.optional(),
    attemptedAt: z.string().datetime(),
    committedAt: z.string().datetime(),
    externalReference: z.string().min(1).max(200).optional(),
    cashTenderedMinor: positive.optional(),
    changeMinor: count.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const attributed = [
      value.capturedByUserId,
      value.businessDayId,
      value.cashSessionId,
    ];
    if (
      attributed.some((v) => v !== undefined) &&
      (!attributed.every((v) => v !== undefined) ||
        value.capturedByUserId !== value.actorId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Incomplete capture attribution",
      });
    if (
      value.method !== "CASH" &&
      (value.cashTenderedMinor !== undefined || value.changeMinor !== undefined)
    )
      ctx.addIssue({ code: "custom", message: "Non-cash tender evidence" });
    if (
      (value.cashTenderedMinor === undefined) !==
        (value.changeMinor === undefined) ||
      (value.cashTenderedMinor !== undefined &&
        BigInt(value.cashTenderedMinor) - BigInt(value.appliedAmountMinor) !==
          BigInt(value.changeMinor ?? -1))
    )
      ctx.addIssue({ code: "custom", message: "Inconsistent cash evidence" });
  });
export const RestaurantPaymentResultSchema = RestaurantPaymentSchema.safeExtend(
  {
    allocations,
    session: z
      .object({
        guestSessionId: id,
        currency,
        status: z.literal("OPEN"),
        version,
        financialRevision: count,
        dueMinor: count,
        paidMinor: count,
        reservedMinor: count,
        pendingPaymentCount: count,
      })
      .strict(),
  },
).superRefine((value, ctx) => {
  if (
    value.allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n) !==
      BigInt(value.appliedAmountMinor) ||
    value.session.guestSessionId !== value.guestSessionId ||
    value.session.currency !== value.currency ||
    BigInt(value.session.paidMinor) + BigInt(value.session.reservedMinor) >
      BigInt(value.session.dueMinor)
  )
    ctx.addIssue({
      code: "custom",
      message: "Inconsistent committed payment result",
    });
});
export const RestaurantPaymentResponseSchema = z
  .object({ data: RestaurantPaymentResultSchema })
  .strict();
export type CaptureRestaurantPaymentRequest = z.infer<
  typeof CaptureRestaurantPaymentRequestSchema
>;
export type RestaurantPayment = z.infer<typeof RestaurantPaymentSchema>;
export type RestaurantPaymentResult = z.infer<
  typeof RestaurantPaymentResultSchema
>;
