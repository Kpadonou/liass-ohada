import { z } from "zod";

/** Customer identity captured before immutable restaurant invoice issuance. */
export const RestaurantInvoiceCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    ifu: z.string().trim().min(1).max(32).optional(),
    contact: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().min(1).max(250).optional(),
  })
  .strict();

export type RestaurantInvoiceCustomer = z.infer<
  typeof RestaurantInvoiceCustomerSchema
>;
