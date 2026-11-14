import { z } from "zod";
import { RestaurantReceiptSummarySchema } from "./receipts";

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
export const RestaurantFiscalSecuritySchema = z.object({
  dateTime: z.string().min(1).max(500), qrCode: z.string().min(1).max(4096),
  codeMECeFDGI: z.string().min(1).max(500), counters: z.string().min(1).max(500),
  nim: z.string().min(1).max(500),
}).strict();
const fields = {
  invoiceId: z.string().uuid(),
  environment: z.literal("TEST"),
  execution: z.enum(["SYNTHETIC", "REAL_TEST"]),
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
    normalizedInvoice: RestaurantReceiptSummarySchema.nullable(),
    securityElements: RestaurantFiscalSecuritySchema.nullable(),
    resultAvailable: z.boolean(),
    evidenceOrigin: z.enum(["SYNTHETIC", "DGI_TEST"]).nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.confirmed === (v.status === "CONFIRMED") &&
      v.resultAvailable === v.confirmed &&
      (!v.normalizedInvoice || !!v.securityElements && v.normalizedInvoice.receiptId === v.invoiceId && v.normalizedInvoice.dueMinor === v.total) &&
      (!v.securityElements || v.confirmed && v.execution === "REAL_TEST" && v.evidenceOrigin === "DGI_TEST") &&
      (v.evidenceOrigin === (v.execution === "REAL_TEST" ? "DGI_TEST" : "SYNTHETIC")) === v.confirmed,
    "Inconsistent fiscal result",
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
