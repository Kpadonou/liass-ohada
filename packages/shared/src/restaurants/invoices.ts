import { z } from "zod";
import {
  RestaurantReceiptPartSchema,
  RestaurantReceiptLineSchema,
  RestaurantReceiptPublicationResponseSchema,
  RestaurantReceiptResponseSchema,
  RestaurantReceiptSummarySchema,
} from "./receipts";

const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Canonical domain name for the immutable commercial document.
 * The wire/storage receipt schemas remain unchanged for digest compatibility.
 */
export const RestaurantInvoiceSummarySchema = z
  .object({
    invoiceId: id,
    guestSessionId: id,
    scopeKind: z.literal("GUEST_SESSION"),
    documentKind: z.literal("INVOICE"),
    schemaVersion: z.literal(1),
    outletName: z.string().min(1),
    restaurantName: z.string().min(1),
    tableName: z.string().min(1),
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dueMinor: z.number().int().nonnegative(),
    paidMinor: z.number().int().nonnegative(),
    paidByMethodMinor: RestaurantReceiptSummarySchema.shape.paidByMethodMinor,
    partCount: z.number().int().nonnegative(),
    commercialPartCount: z.number().int().nonnegative(),
    settlementPartCount: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative(),
    paymentCount: z.number().int().nonnegative(),
    digest,
    issuedAt: z.string().datetime(),
  })
  .strict();

export const RestaurantInvoiceLineSchema = RestaurantReceiptLineSchema;

export const RestaurantInvoicePartSchema = RestaurantReceiptPartSchema;

export const RestaurantInvoiceViewSchema = z
  .object({
    data: RestaurantInvoiceSummarySchema,
    parts: z.array(RestaurantInvoicePartSchema).max(8),
    nextCursor: z.string().optional(),
  })
  .strict();

export type RestaurantInvoiceSummary = z.infer<
  typeof RestaurantInvoiceSummarySchema
>;
export type RestaurantInvoice = RestaurantInvoiceSummary;
export type RestaurantInvoiceLine = z.infer<typeof RestaurantInvoiceLineSchema>;
export type RestaurantInvoicePart = z.infer<typeof RestaurantInvoicePartSchema>;
export type RestaurantInvoiceView = z.infer<typeof RestaurantInvoiceViewSchema>;

export function invoiceIdFromLegacyAliases(input: {
  invoiceId?: string;
  finalBillId?: string;
  receiptId?: string;
}): string {
  const aliases = [input.invoiceId, input.finalBillId, input.receiptId].filter(
    (value): value is string => Boolean(value),
  );
  if (aliases.length === 0) throw new Error("Invoice identity is required");
  if (new Set(aliases).size !== 1)
    throw new Error("Contradictory invoice aliases");
  return id.parse(aliases[0]);
}

export function adaptReceiptSummaryToInvoice(
  summary: z.infer<typeof RestaurantReceiptSummarySchema>,
): RestaurantInvoiceSummary {
  const aliases = summary as typeof summary & { invoiceId?: string };
  invoiceIdFromLegacyAliases(aliases);
  const { receiptId, ...rest } = RestaurantReceiptSummarySchema.parse(
    Object.fromEntries(
      Object.entries(summary).filter(([key]) => key !== "invoiceId"),
    ),
  );
  return RestaurantInvoiceSummarySchema.parse({
    ...rest,
    invoiceId: receiptId,
    documentKind: "INVOICE",
  });
}

export function adaptReceiptViewToInvoice(
  view: z.infer<typeof RestaurantReceiptResponseSchema>,
): RestaurantInvoiceView {
  return RestaurantInvoiceViewSchema.parse({
    ...view,
    data: adaptReceiptSummaryToInvoice(view.data),
  });
}

export function adaptPublicationToInvoice(
  response: z.infer<typeof RestaurantReceiptPublicationResponseSchema>,
) {
  if (response.data.state === "BUILDING") {
    return {
      data: {
        state: "BUILDING" as const,
        invoiceId: invoiceIdFromLegacyAliases({
          receiptId: response.data.receiptId,
        }),
        version: response.data.version,
        partCount: response.data.partCount,
      },
    };
  }
  return {
    data: {
      state: "FINAL" as const,
      invoice: adaptReceiptSummaryToInvoice(response.data.receipt),
    },
  };
}
