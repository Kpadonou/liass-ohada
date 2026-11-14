// DTOs transcribed from the official DGI TEST OpenAPI v1 (2026-11-05).

// OpenAPI has no required fields; operation-level checks below tighten successful responses.

import { z } from "zod";
import { canonical } from "@/lambda/shared/authority/integrity";

/** Canonical DGI request bytes. Unlike immutable LIASS authority artifacts, the
 * official provider contract legitimately carries finite decimal quantities.
 * Integer-only payloads remain byte-compatible with the authority canonicalizer.
 */
export function canonicalBeninRequest(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || Object.is(value, -0))
      throw new Error("INVALID_BENIN_REQUEST_NUMBER");
    return Number.isSafeInteger(value)
      ? canonical(value)
      : JSON.stringify(value);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return canonical(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalBeninRequest).join(",")}]`;
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("INVALID_BENIN_REQUEST_VALUE");
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${canonical(key)}:${canonicalBeninRequest((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

export const TaxGroupsDtoSchema = z
  .object({
    a: z.number().int().safe().optional(),
    b: z.number().int().safe().optional(),
    c: z.number().int().safe().optional(),
    d: z.number().int().safe().optional(),
    e: z.number().int().safe().optional(),
    f: z.number().int().safe().optional(),
    aibA: z.number().int().safe().optional(),
    aibB: z.number().int().safe().optional(),
  })
  .strict();

export const InvoiceTypeDtoSchema = z
  .object({
    type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

export const PaymentTypeDtoSchema = z
  .object({
    type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

export const AibGroupTypeEnumSchema = z.enum(["A", "B"]);

export const InvoiceTypeEnumSchema = z.enum(["FV", "FA", "EV", "EA"]);

export const TaxGroupTypeEnumSchema = z.enum(["A", "B", "C", "D", "E", "F"]);

export const ItemDtoSchema = z
  .object({
    code: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    price: z.number().int().safe().optional(),
    quantity: z.number().finite().optional(),
    taxGroup: TaxGroupTypeEnumSchema.optional(),
    taxSpecific: z.number().int().safe().nullable().optional(),
    originalPrice: z.number().finite().nullable().optional(),
    priceModification: z.string().nullable().optional(),
  })
  .strict();

export const ClientDtoSchema = z
  .object({
    ifu: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    contact: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
  })
  .strict();

export const OperatorDtoSchema = z
  .object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .strict();

export const PaymentTypeEnumSchema = z.enum([
  "ESPECES",
  "VIREMENT",
  "CARTEBANCAIRE",
  "MOBILEMONEY",
  "CHEQUES",
  "CREDIT",
  "AUTRE",
]);

export const PaymentDtoSchema = z
  .object({
    name: PaymentTypeEnumSchema.optional(),
    amount: z.number().int().safe().optional(),
  })
  .strict();

export const InvoiceRequestDataDtoSchema = z
  .object({
    ifu: z.string().nullable().optional(),
    aib: AibGroupTypeEnumSchema.optional(),
    type: InvoiceTypeEnumSchema.optional(),
    items: z.array(ItemDtoSchema).nullable().optional(),
    client: ClientDtoSchema.optional(),
    operator: OperatorDtoSchema.optional(),
    payment: z.array(PaymentDtoSchema).nullable().optional(),
    reference: z.string().nullable().optional(),
  })
  .strict();

export const InvoiceResponseDtoSchema = z
  .object({
    uid: z.string().nullable().optional(),
    ta: z.number().int().safe().optional(),
    tb: z.number().int().safe().optional(),
    tc: z.number().int().safe().optional(),
    td: z.number().int().safe().optional(),
    taa: z.number().int().safe().optional(),
    tab: z.number().int().safe().optional(),
    tac: z.number().int().safe().optional(),
    tad: z.number().int().safe().optional(),
    tae: z.number().int().safe().optional(),
    taf: z.number().int().safe().optional(),
    hab: z.number().int().safe().optional(),
    had: z.number().int().safe().optional(),
    vab: z.number().int().safe().optional(),
    vad: z.number().int().safe().optional(),
    aib: z.number().int().safe().optional(),
    ts: z.number().int().safe().optional(),
    total: z.number().int().safe().optional(),
    errorCode: z.string().nullable().optional(),
    errorDesc: z.string().nullable().optional(),
  })
  .strict();

export const InvoiceDetailsDtoSchema = z
  .object({
    ifu: z.string().nullable().optional(),
    // The TEST API materializes these optional Swagger properties as null.
    // Normalize null to absence without relaxing their non-null value schemas.
    aib: z.preprocess(
      (value) => (value === null ? undefined : value),
      AibGroupTypeEnumSchema.optional(),
    ),
    // Normalize only surrounding whitespace; the official enum remains strict.
    type: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      InvoiceTypeEnumSchema.optional(),
    ),
    items: z.array(ItemDtoSchema).nullable().optional(),
    client: z.preprocess(
      (value) => (value === null ? undefined : value),
      ClientDtoSchema.optional(),
    ),
    operator: z.preprocess(
      (value) => (value === null ? undefined : value),
      OperatorDtoSchema.optional(),
    ),
    payment: z.array(PaymentDtoSchema).nullable().optional(),
    reference: z.string().nullable().optional(),
    errorCode: z.string().nullable().optional(),
    errorDesc: z.string().nullable().optional(),
    paymentUrl: z.string().nullable().optional(),
  })
  .strict();

export const SecurityElementsDtoSchema = z
  .object({
    dateTime: z.string().nullable().optional(),
    qrCode: z.string().nullable().optional(),
    codeMECeFDGI: z.string().nullable().optional(),
    counters: z.string().nullable().optional(),
    nim: z.string().nullable().optional(),
    refundWithAibPayment: z.boolean().optional(),
    errorCode: z.string().nullable().optional(),
    errorDesc: z.string().nullable().optional(),
  })
  .strict();

export type BeninInvoiceRequest = z.infer<typeof InvoiceRequestDataDtoSchema>;
