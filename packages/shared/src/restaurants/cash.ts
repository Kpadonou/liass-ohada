import { z } from "zod";
import {
  RestaurantPaidByMethodSchema,
  RestaurantPaymentMethodSchema,
} from "./payments";
const id = z.string().uuid();
const actor = z.string().min(1).max(200);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const signed = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const version = money.positive();
const timestamp = z.string().datetime();
const scope = { orgId: actor, outletId: id };
const closing = { closedAt: timestamp.optional(), closedBy: actor.optional() };
export const RestaurantOperationalTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
export const RestaurantBusinessDaySchema = z
  .object({
    ...scope,
    businessDayId: id,
    businessDate: z.string().date(),
    operationalTimezone: RestaurantOperationalTimezoneSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(["OPEN", "CLOSED"]),
    openedAt: timestamp,
    openedBy: actor,
    ...closing,
    version,
    sessionCount: money.max(100),
    openSessionCount: money.max(100),
  })
  .strict()
  .refine(
    (v) =>
      v.openSessionCount <= v.sessionCount &&
      (v.status === "CLOSED"
        ? !!v.closedAt && !!v.closedBy && v.openSessionCount === 0
        : !v.closedAt && !v.closedBy),
  );
export const RestaurantCashSessionSchema = z
  .object({
    ...scope,
    cashSessionId: id,
    businessDayId: id,
    cashierUserId: actor,
    cashierDisplayName: z.string().min(1).max(160).nullable(),
    openedAt: timestamp,
    openedBy: actor,
    openingCashAmountMinor: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(["OPEN", "CLOSED"]),
    ...closing,
    version,
    paymentCount: money,
    paidByMethodMinor: RestaurantPaidByMethodSchema,
    cashInMinor: money,
    cashOutMinor: money,
    countedCashAmountMinor: money.optional(),
    expectedCashAmountMinor: signed,
    varianceAmountMinor: signed.optional(),
  })
  .strict()
  .refine((v) => {
    const expected =
      BigInt(v.openingCashAmountMinor) +
      BigInt(v.paidByMethodMinor.CASH) +
      BigInt(v.cashInMinor) -
      BigInt(v.cashOutMinor);
    return (
      expected === BigInt(v.expectedCashAmountMinor) &&
      (v.status === "CLOSED"
        ? !!v.closedAt &&
          !!v.closedBy &&
          v.countedCashAmountMinor !== undefined &&
          v.varianceAmountMinor !== undefined &&
          BigInt(v.countedCashAmountMinor) - expected ===
            BigInt(v.varianceAmountMinor)
        : !v.closedAt &&
          !v.closedBy &&
          v.countedCashAmountMinor === undefined &&
          v.varianceAmountMinor === undefined)
    );
  });
export const RestaurantCashMovementSchema = z
  .object({
    ...scope,
    movementId: id,
    businessDayId: id,
    cashSessionId: id,
    type: z.enum(["CASH_IN", "CASH_OUT"]),
    amountMinor: money.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    actorId: actor,
    occurredAt: timestamp,
    createdAt: timestamp,
    clientRequestId: id,
  })
  .strict();
export const OpenRestaurantBusinessDayRequestSchema = z
  .object({
    clientRequestId: id,
    operationalTimezone: RestaurantOperationalTimezoneSchema,
  })
  .strict();
export const OpenRestaurantCashSessionRequestSchema = z
  .object({ clientRequestId: id, openingCashAmountMinor: money })
  .strict();
export const CloseRestaurantBusinessDayRequestSchema = z
  .object({ clientRequestId: id, expectedVersion: version })
  .strict();
export const CloseRestaurantCashSessionRequestSchema =
  CloseRestaurantBusinessDayRequestSchema.extend({
    countedCashAmountMinor: money,
  }).strict();
export const AddRestaurantCashMovementRequestSchema = z
  .object({
    clientRequestId: id,
    expectedVersion: version,
    type: RestaurantCashMovementSchema.shape.type,
    amountMinor: money.positive(),
    reason: RestaurantCashMovementSchema.shape.reason,
  })
  .strict();
export const RestaurantCashListRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict();
export const RestaurantCashSessionSummarySchema = z
  .object({
    session: RestaurantCashSessionSchema,
    totalPaymentsMinor: money,
    physicalCashPaymentsMinor: money,
    nonCashPaymentsMinor: money,
  })
  .strict();
export const RestaurantBusinessDaySummarySchema = z
  .object({
    businessDay: RestaurantBusinessDaySchema,
    observedAt: timestamp,
    attributionCoverage: z.literal("ATTRIBUTED_ONLY"),
    paymentCount: money,
    totalPaymentsMinor: money,
    paidByMethodMinor: RestaurantPaidByMethodSchema,
    physicalCashPaymentsMinor: money,
    nonCashPaymentsMinor: money,
    cashInMinor: money,
    cashOutMinor: money,
    sessionCount: money,
    openSessionCount: money,
    closedSessionCount: money,
    closedVarianceMinor: signed,
    sessions: z.array(RestaurantCashSessionSummarySchema).max(100),
  })
  .strict();
export const RestaurantCashPaymentFactSchema = z
  .object({
    ...scope,
    paymentId: id,
    businessDayId: id,
    cashSessionId: id,
    capturedByUserId: actor,
    method: RestaurantPaymentMethodSchema,
    amountMinor: money.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    capturedAt: timestamp,
    kind: z.literal("CAPTURE"),
  })
  .strict();
export const RestaurantBusinessDayResponseSchema = z
  .object({ data: RestaurantBusinessDaySchema })
  .strict();
export const RestaurantCurrentBusinessDayResponseSchema = z
  .object({ data: RestaurantBusinessDaySchema.nullable() })
  .strict();
export const RestaurantCashSessionResponseSchema = z
  .object({ data: RestaurantCashSessionSchema })
  .strict();
export const RestaurantCurrentCashSessionResponseSchema = z
  .object({ data: RestaurantCashSessionSchema.nullable() })
  .strict();
export const RestaurantCashMovementResponseSchema = z
  .object({ data: RestaurantCashMovementSchema })
  .strict();
export const RestaurantBusinessDaySummaryResponseSchema = z
  .object({ data: RestaurantBusinessDaySummarySchema })
  .strict();
export const RestaurantCashSessionSummaryResponseSchema = z
  .object({ data: RestaurantCashSessionSummarySchema })
  .strict();
export const RestaurantBusinessDayListResponseSchema = z
  .object({
    items: z.array(RestaurantBusinessDaySchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantCashSessionListResponseSchema = z
  .object({
    items: z.array(RestaurantCashSessionSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export const RestaurantCashMovementListResponseSchema = z
  .object({
    items: z.array(RestaurantCashMovementSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export function restaurantPaymentSemantic(
  method: z.infer<typeof RestaurantPaymentMethodSchema>,
): "PHYSICAL_CASH" | "NON_CASH" {
  return method === "CASH" ? "PHYSICAL_CASH" : "NON_CASH";
}
export type RestaurantBusinessDay = z.infer<typeof RestaurantBusinessDaySchema>;
export type RestaurantCashSession = z.infer<typeof RestaurantCashSessionSchema>;
export type RestaurantCashMovement = z.infer<
  typeof RestaurantCashMovementSchema
>;
export type RestaurantCashSessionSummary = z.infer<
  typeof RestaurantCashSessionSummarySchema
>;
export type RestaurantBusinessDaySummary = z.infer<
  typeof RestaurantBusinessDaySummarySchema
>;
