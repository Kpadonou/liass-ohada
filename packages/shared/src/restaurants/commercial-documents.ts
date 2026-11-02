import { z } from "zod";
import { RestaurantCreditNoteSchema } from "./credit-notes";
import { RestaurantRefundSchema } from "./refunds";
import { invoiceIdFromLegacyAliases } from "./invoices";

export const RestaurantInvoiceCreditNoteSchema =
  RestaurantCreditNoteSchema.omit({
    finalBillId: true,
    sourceReceiptDigest: true,
  }).extend({
    invoiceId: z.string().uuid(),
    sourceInvoiceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  });

export const RestaurantInvoiceRefundSchema = RestaurantRefundSchema.omit({
  finalBillId: true,
}).extend({ invoiceId: z.string().uuid() });

export type RestaurantInvoiceCreditNote = z.infer<
  typeof RestaurantInvoiceCreditNoteSchema
>;
export type RestaurantInvoiceRefund = z.infer<
  typeof RestaurantInvoiceRefundSchema
>;

/** Strict V1 persistence/transport boundary; never used inside a hashed source. */
export function creditNoteToLegacyWire(value: RestaurantInvoiceCreditNote) {
  const { invoiceId, sourceInvoiceDigest, ...rest } =
    RestaurantInvoiceCreditNoteSchema.parse(value);
  return RestaurantCreditNoteSchema.parse({
    ...rest,
    finalBillId: invoiceId,
    sourceReceiptDigest: sourceInvoiceDigest,
  });
}

export function adaptCreditNoteToInvoice(
  creditNote: z.infer<typeof RestaurantCreditNoteSchema>,
): RestaurantInvoiceCreditNote {
  const aliases = creditNote as typeof creditNote & {
    invoiceId?: string;
    sourceInvoiceDigest?: string;
  };
  const invoiceId = invoiceIdFromLegacyAliases(aliases);
  if (
    aliases.sourceInvoiceDigest !== undefined &&
    aliases.sourceInvoiceDigest !== creditNote.sourceReceiptDigest
  )
    throw new Error("Contradictory invoice digest aliases");
  const {
    finalBillId: _id,
    sourceReceiptDigest,
    ...rest
  } = RestaurantCreditNoteSchema.parse(
    Object.fromEntries(
      Object.entries(creditNote).filter(
        ([key]) => !["invoiceId", "sourceInvoiceDigest"].includes(key),
      ),
    ),
  );
  return RestaurantInvoiceCreditNoteSchema.parse({
    ...rest,
    invoiceId,
    sourceInvoiceDigest: sourceReceiptDigest,
  });
}

export function adaptRefundToInvoice(
  refund: z.infer<typeof RestaurantRefundSchema>,
  invoiceId?: string,
): RestaurantInvoiceRefund {
  const aliases = refund as typeof refund & { invoiceId?: string };
  invoiceIdFromLegacyAliases(aliases);
  const { finalBillId, ...rest } = RestaurantRefundSchema.parse(
    Object.fromEntries(
      Object.entries(refund).filter(([key]) => key !== "invoiceId"),
    ),
  );
  return RestaurantInvoiceRefundSchema.parse({
    ...rest,
    invoiceId: invoiceIdFromLegacyAliases({
      invoiceId,
      finalBillId,
    }),
  });
}
