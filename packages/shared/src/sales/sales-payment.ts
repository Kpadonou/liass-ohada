import { z } from "zod";
import { SalesInvoiceIssueDateSchema, SalesInvoiceMoneySchema } from "./sales-invoice";
import { CurrencyCodeSchema } from "./sales-settings";

const toScaledInteger = (value: string, scale: number): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
};

const receivableAmountsAreConsistent = (value: {
  amountPaid: string;
  balanceDue: string;
  invoiceAmount: string;
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
}): boolean => {
  const scale = Math.max(
    value.amountPaid.split(".")[1]?.length ?? 0,
    value.balanceDue.split(".")[1]?.length ?? 0,
    value.invoiceAmount.split(".")[1]?.length ?? 0,
  );
  const paid = toScaledInteger(value.amountPaid, scale);
  const balance = toScaledInteger(value.balanceDue, scale);
  const invoice = toScaledInteger(value.invoiceAmount, scale);
  const expectedStatus = invoice === 0n || paid === invoice
    ? "PAID"
    : paid === 0n
      ? "UNPAID"
      : "PARTIALLY_PAID";
  return paid + balance === invoice && paid <= invoice && value.status === expectedStatus;
};

export const SalesReceivableStatusSchema = z.enum([
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
]);

export const SalesInvoiceReceivableSchema = z
  .object({
    invoiceId: z.string().min(1),
    currency: CurrencyCodeSchema,
    invoiceAmount: SalesInvoiceMoneySchema,
    amountPaid: SalesInvoiceMoneySchema,
    balanceDue: SalesInvoiceMoneySchema,
    status: SalesReceivableStatusSchema,
    paymentCount: z.number().int().min(0),
    version: z.number().int().min(0),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(receivableAmountsAreConsistent, {
    message: "Receivable amounts and status must be consistent",
  });

export const SalesPaymentMethodSchema = z.enum([
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "MOBILE_MONEY",
  "CHEQUE",
  "OTHER",
]);

export const SalesPaymentAmountSchema = SalesInvoiceMoneySchema.refine(
  (value) => /[1-9]/.test(value.replace(".", "")),
  { message: "Payment amount must be greater than zero" },
);

export const SalesPaymentSchema = z
  .object({
    id: z.string().min(1),
    invoiceId: z.string().min(1),
    amount: SalesInvoiceMoneySchema,
    currency: CurrencyCodeSchema,
    paymentDate: SalesInvoiceIssueDateSchema,
    method: SalesPaymentMethodSchema,
    reference: z.string().trim().min(1).max(200).optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const RecordSalesPaymentRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    clientRequestId: z.string().uuid(),
    amount: SalesPaymentAmountSchema,
    paymentDate: SalesInvoiceIssueDateSchema,
    method: SalesPaymentMethodSchema,
    reference: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const RecordSalesPaymentResponseSchema = z
  .object({
    payment: SalesPaymentSchema,
    receivable: SalesInvoiceReceivableSchema,
  })
  .strict();

export const ListSalesPaymentsRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const SalesPaymentListResponseSchema = z
  .object({
    items: z.array(SalesPaymentSchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type SalesReceivableStatus = z.infer<typeof SalesReceivableStatusSchema>;
export type SalesInvoiceReceivable = z.infer<typeof SalesInvoiceReceivableSchema>;
export type SalesPaymentMethod = z.infer<typeof SalesPaymentMethodSchema>;
export type SalesPayment = z.infer<typeof SalesPaymentSchema>;
export type RecordSalesPaymentRequest = z.infer<typeof RecordSalesPaymentRequestSchema>;
export type RecordSalesPaymentResponse = z.infer<typeof RecordSalesPaymentResponseSchema>;
export type ListSalesPaymentsRequest = z.infer<typeof ListSalesPaymentsRequestSchema>;
export type SalesPaymentListResponse = z.infer<typeof SalesPaymentListResponseSchema>;
