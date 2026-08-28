import { z } from "zod";
import { WorkspaceCountrySchema } from "../shared/workspace";

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().trim().min(1).max(maxLength).optional(),
  );

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().max(254).email().optional(),
);

export const SalesCustomerTypeSchema = z.enum(["BUSINESS", "INDIVIDUAL"]);

/** SALES-owned address contract. It is not a Cabinet/Identity persistence type. */
export const SalesCustomerAddressSchema = z
  .object({
    line1: optionalTrimmedString(200),
    line2: optionalTrimmedString(200),
    city: optionalTrimmedString(120),
    postalCode: optionalTrimmedString(32),
    country: WorkspaceCountrySchema.optional(),
  })
  .strict();

const mutableCustomerFields = {
  customerType: SalesCustomerTypeSchema,
  name: z.string().trim().min(1).max(160),
  email: optionalEmail,
  phone: optionalTrimmedString(40),
  taxIdentifier: optionalTrimmedString(100),
  billingAddress: SalesCustomerAddressSchema.optional(),
};

export const SalesCustomerSchema = z
  .object({
    id: z.string().min(1),
    ...mutableCustomerFields,
    isActive: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const CreateSalesCustomerRequestSchema = z
  .object(mutableCustomerFields)
  .strict();

export const UpdateSalesCustomerRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    customerType: mutableCustomerFields.customerType.optional(),
    name: mutableCustomerFields.name.optional(),
    email: mutableCustomerFields.email,
    phone: mutableCustomerFields.phone,
    taxIdentifier: mutableCustomerFields.taxIdentifier,
    billingAddress: mutableCustomerFields.billingAddress,
  })
  .strict()
  .refine(
    (request) =>
      Object.keys(request).some((field) => field !== "expectedVersion"),
    { message: "At least one customer field is required" },
  );

export const SalesCustomerIdRequestSchema = z
  .object({ customerId: z.string().trim().min(1).max(200) })
  .strict();

export const SalesCustomerLifecycleRequestSchema =
  SalesCustomerIdRequestSchema.extend({
    expectedVersion: z.number().int().positive(),
  }).strict();

export const ListSalesCustomersRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const SalesCustomerListResponseSchema = z
  .object({
    items: z.array(SalesCustomerSchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type SalesCustomerType = z.infer<typeof SalesCustomerTypeSchema>;
export type SalesCustomerAddress = z.infer<
  typeof SalesCustomerAddressSchema
>;
export type SalesCustomer = z.infer<typeof SalesCustomerSchema>;
export type CreateSalesCustomerRequest = z.infer<
  typeof CreateSalesCustomerRequestSchema
>;
export type UpdateSalesCustomerRequest = z.infer<
  typeof UpdateSalesCustomerRequestSchema
>;
export type SalesCustomerLifecycleRequest = z.infer<
  typeof SalesCustomerLifecycleRequestSchema
>;
export type ListSalesCustomersRequest = z.infer<
  typeof ListSalesCustomersRequestSchema
>;
export type SalesCustomerListResponse = z.infer<
  typeof SalesCustomerListResponseSchema
>;
