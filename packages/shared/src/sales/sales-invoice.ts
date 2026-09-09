import { z } from "zod";
import { SalesCustomerAddressSchema } from "./sales-customer";
import { CurrencyCodeSchema } from "./sales-settings";

const decimalPattern = /^(?:0|[1-9]\d{0,17})(?:\.\d+)?$/;

const decimalString = (fractionDigits: number) =>
  z
    .string()
    .max(25)
    .regex(decimalPattern)
    .refine((value) => (value.split(".")[1]?.length ?? 0) <= fractionDigits, {
      message: `Must have at most ${fractionDigits} fractional digits`,
    });

const isPositiveDecimal = (value: string): boolean =>
  /[1-9]/.test(value.replace(".", ""));

const isAtMostOneHundred = (value: string): boolean => {
  const [whole] = value.split(".");
  return Number(whole) < 100 || (Number(whole) === 100 && /^100(?:\.0+)?$/.test(value));
};

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().trim().min(1).max(maxLength).optional(),
  );

export const SalesInvoiceQuantitySchema = decimalString(6).refine(
  isPositiveDecimal,
  { message: "Quantity must be greater than zero" },
);

export const SalesInvoiceUnitPriceSchema = decimalString(6);

export const SalesInvoiceTaxRateSchema = decimalString(4).refine(
  isAtMostOneHundred,
  { message: "Tax rate must be between zero and 100" },
);

/** Canonical JSON-safe monetary amount, expressed in the invoice currency. */
export const SalesInvoiceMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);

export const SalesInvoiceStatusSchema = z.enum(["DRAFT", "ISSUED"]);

export const SalesInvoiceIssueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (month < 1 || month > 12 || day < 1) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysInMonth[month - 1];
  }, { message: "Issue date must be a valid calendar date" });

export const SalesInvoiceCustomerSnapshotSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().max(254).email().optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    taxIdentifier: z.string().trim().min(1).max(100).optional(),
    billingAddress: SalesCustomerAddressSchema.optional(),
  })
  .strict();

export const SalesInvoiceLineSchema = z
  .object({
    id: z.string().min(1),
    position: z.number().int().positive(),
    catalogItemId: z.string().min(1).optional(),
    description: z.string().trim().min(1).max(2000),
    unit: z.string().trim().min(1).max(80).optional(),
    quantity: SalesInvoiceQuantitySchema,
    unitPrice: SalesInvoiceUnitPriceSchema,
    taxRate: SalesInvoiceTaxRateSchema,
    subtotal: SalesInvoiceMoneySchema,
    taxAmount: SalesInvoiceMoneySchema,
    total: SalesInvoiceMoneySchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const invoiceHeaderFields = {
  id: z.string().min(1),
  currency: CurrencyCodeSchema,
  customerId: z.string().min(1).optional(),
  customerSnapshot: SalesInvoiceCustomerSnapshotSchema.optional(),
  subtotal: SalesInvoiceMoneySchema,
  taxTotal: SalesInvoiceMoneySchema,
  total: SalesInvoiceMoneySchema,
  lineCount: z.number().int().min(0).max(100),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

const SalesInvoiceBaseSchema = z
  .object({
    ...invoiceHeaderFields,
    lines: z.array(SalesInvoiceLineSchema).max(100),
  })
  .strict();

const lineCountMatches = (invoice: { lineCount: number; lines: unknown[] }) =>
  invoice.lineCount === invoice.lines.length;

const customerSnapshotMatches = (invoice: {
  customerId?: string;
  customerSnapshot?: unknown;
}) => (invoice.customerId === undefined) ===
  (invoice.customerSnapshot === undefined);

export const SalesDraftInvoiceSchema = SalesInvoiceBaseSchema.extend({
  status: z.literal("DRAFT"),
}).strict().refine(lineCountMatches, {
  message: "Invoice line count must match lines",
  path: ["lineCount"],
}).refine(customerSnapshotMatches, {
  message: "Customer id and snapshot must be present together",
  path: ["customerSnapshot"],
});

export const SalesIssuedInvoiceSchema = SalesInvoiceBaseSchema.extend({
    status: z.literal("ISSUED"),
    invoiceNumber: z.string().regex(/^0*[1-9]\d*$/),
    issueDate: SalesInvoiceIssueDateSchema,
    issuedAt: z.string().datetime(),
}).strict().refine(lineCountMatches, {
  message: "Invoice line count must match lines",
  path: ["lineCount"],
}).refine(customerSnapshotMatches, {
  message: "Customer id and snapshot must be present together",
  path: ["customerSnapshot"],
}).refine((invoice) => invoice.lineCount >= 1, {
  message: "Issued invoice must contain at least one line",
  path: ["lineCount"],
});

export const SalesInvoiceSchema = z.discriminatedUnion("status", [
  SalesDraftInvoiceSchema,
  SalesIssuedInvoiceSchema,
]);

const SalesInvoiceSummaryBaseSchema = z
  .object({
    ...invoiceHeaderFields,
    customerName: z.string().trim().min(1).max(160).optional(),
  })
  .omit({ customerSnapshot: true })
  .strict();

export const SalesDraftInvoiceSummarySchema =
  SalesInvoiceSummaryBaseSchema.extend({ status: z.literal("DRAFT") }).strict();

export const SalesIssuedInvoiceSummarySchema =
  SalesInvoiceSummaryBaseSchema.extend({
    status: z.literal("ISSUED"),
    invoiceNumber: z.string().regex(/^0*[1-9]\d*$/),
    issueDate: SalesInvoiceIssueDateSchema,
  }).strict().refine((invoice) => invoice.lineCount >= 1, {
    message: "Issued invoice summary must contain at least one line",
    path: ["lineCount"],
  });

export const SalesInvoiceSummarySchema = z.discriminatedUnion("status", [
  SalesDraftInvoiceSummarySchema,
  SalesIssuedInvoiceSummarySchema,
]);

export const CreateSalesInvoiceRequestSchema = z
  .object({
    customerId: z.string().trim().min(1).max(200).optional(),
    currency: CurrencyCodeSchema.optional(),
  })
  .strict();

export const UpdateSalesInvoiceRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    customerId: z.string().trim().min(1).max(200).nullable().optional(),
    currency: CurrencyCodeSchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      Object.keys(request).some((field) => field !== "expectedVersion"),
    { message: "At least one invoice field is required" },
  );

export const AddSalesInvoiceLineRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    catalogItemId: z.string().trim().min(1).max(200).optional(),
    description: optionalTrimmedString(2000),
    unit: optionalTrimmedString(80),
    quantity: SalesInvoiceQuantitySchema,
    unitPrice: SalesInvoiceUnitPriceSchema,
    taxRate: SalesInvoiceTaxRateSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.catalogItemId && !request.description) {
      context.addIssue({
        code: "custom",
        message: "Description is required for a free-form line",
        path: ["description"],
      });
    }
  });

export const UpdateSalesInvoiceLineRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    description: z.string().trim().min(1).max(2000).optional(),
    unit: optionalTrimmedString(80).nullable(),
    quantity: SalesInvoiceQuantitySchema.optional(),
    unitPrice: SalesInvoiceUnitPriceSchema.optional(),
    taxRate: SalesInvoiceTaxRateSchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      Object.keys(request).some((field) => field !== "expectedVersion"),
    { message: "At least one invoice line field is required" },
  );

export const RemoveSalesInvoiceLineRequestSchema = z
  .object({ expectedVersion: z.coerce.number().int().positive() })
  .strict();

export const IssueSalesInvoiceRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    clientRequestId: z.string().uuid(),
    issueDate: SalesInvoiceIssueDateSchema,
  })
  .strict();

export const SalesInvoiceIdRequestSchema = z
  .object({ invoiceId: z.string().trim().min(1).max(200) })
  .strict();

export const SalesInvoiceLineIdRequestSchema = SalesInvoiceIdRequestSchema.extend({
  lineId: z.string().trim().min(1).max(200),
}).strict();

export const ListSalesInvoicesRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const SalesInvoiceListResponseSchema = z
  .object({
    items: z.array(SalesInvoiceSummarySchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type SalesInvoiceStatus = z.infer<typeof SalesInvoiceStatusSchema>;
export type SalesInvoiceCustomerSnapshot = z.infer<typeof SalesInvoiceCustomerSnapshotSchema>;
export type SalesInvoiceLine = z.infer<typeof SalesInvoiceLineSchema>;
export type SalesInvoice = z.infer<typeof SalesInvoiceSchema>;
export type SalesDraftInvoice = z.infer<typeof SalesDraftInvoiceSchema>;
export type SalesIssuedInvoice = z.infer<typeof SalesIssuedInvoiceSchema>;
export type SalesInvoiceSummary = z.infer<typeof SalesInvoiceSummarySchema>;
export type CreateSalesInvoiceRequest = z.infer<typeof CreateSalesInvoiceRequestSchema>;
export type UpdateSalesInvoiceRequest = z.infer<typeof UpdateSalesInvoiceRequestSchema>;
export type AddSalesInvoiceLineRequest = z.infer<typeof AddSalesInvoiceLineRequestSchema>;
export type UpdateSalesInvoiceLineRequest = z.infer<typeof UpdateSalesInvoiceLineRequestSchema>;
export type RemoveSalesInvoiceLineRequest = z.infer<typeof RemoveSalesInvoiceLineRequestSchema>;
export type IssueSalesInvoiceRequest = z.infer<typeof IssueSalesInvoiceRequestSchema>;
export type ListSalesInvoicesRequest = z.infer<typeof ListSalesInvoicesRequestSchema>;
export type SalesInvoiceListResponse = z.infer<typeof SalesInvoiceListResponseSchema>;
