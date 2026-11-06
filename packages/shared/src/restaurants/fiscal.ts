import { z } from "zod";

export const RestaurantFiscalSourceRequestSchema = z
  .object({
    outletId: z.string().uuid(),
    sessionId: z.string().uuid(),
    invoiceId: z.string().uuid(),
  })
  .strict();
const command = z.string().trim().min(1).max(200);
export const RestaurantFiscalInitiateRequestSchema =
  RestaurantFiscalSourceRequestSchema.extend({
    attemptId: command,
    commandId: command,
  }).strict();
export const RestaurantFiscalConfirmRequestSchema =
  RestaurantFiscalSourceRequestSchema.extend({
    commandId: command,
    confirm: z.literal(true),
  }).strict();
export const RestaurantFiscalStatusSchema = z.enum([
  "NOT_STARTED",
  "RESERVED",
  "CREATE_IN_FLIGHT",
  "CREATED",
  "CONFIRM_IN_FLIGHT",
  "CONFIRMED",
  "CANCEL_IN_FLIGHT",
  "CANCELLED",
  "UNKNOWN_OUTCOME",
  "FAILED",
]);
const fields = {
  invoiceId: z.string().uuid(),
  environment: z.literal("TEST"),
  execution: z.literal("SYNTHETIC"),
  status: RestaurantFiscalStatusSchema,
  confirmed: z.boolean(),
  legallyNormalized: z.literal(false),
  normalizedInvoice: z.null(),
  securityElements: z.null(),
  total: z.number().int().safe().nonnegative().nullable(),
  uncertainOperation: z.enum(["CREATE", "CONFIRM", "CANCEL"]).nullable(),
  mutationRetryAllowed: z.literal(false),
};
export const RestaurantFiscalStatusResponseSchema = z
  .object(fields)
  .strict()
  .refine(
    (v) => v.confirmed === (v.status === "CONFIRMED"),
    "Inconsistent fiscal status",
  );
export const RestaurantFiscalResultResponseSchema = z
  .object({
    ...fields,
    resultAvailable: z.boolean(),
    evidenceOrigin: z.literal("SYNTHETIC").nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.confirmed === (v.status === "CONFIRMED") &&
      v.resultAvailable === v.confirmed &&
      (v.evidenceOrigin === "SYNTHETIC") === v.confirmed,
    "Inconsistent synthetic result",
  );
export type RestaurantFiscalSourceRequest = z.infer<
  typeof RestaurantFiscalSourceRequestSchema
>;
export type RestaurantFiscalInitiateRequest = z.infer<
  typeof RestaurantFiscalInitiateRequestSchema
>;
export type RestaurantFiscalConfirmRequest = z.infer<
  typeof RestaurantFiscalConfirmRequestSchema
>;
export type RestaurantFiscalStatusResponse = z.infer<
  typeof RestaurantFiscalStatusResponseSchema
>;
export type RestaurantFiscalResultResponse = z.infer<
  typeof RestaurantFiscalResultResponseSchema
>;
