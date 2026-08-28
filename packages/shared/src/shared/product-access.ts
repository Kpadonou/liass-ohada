import { z } from "zod";

export const PRODUCT_CODES = ["ACCOUNTING", "SALES"] as const;
export const PRODUCT_ACCESS_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export const ProductCodeSchema = z.enum(PRODUCT_CODES);
export const ProductAccessStatusSchema = z.enum(PRODUCT_ACCESS_STATUSES);

export const ProductAccessSchema = z
  .object({
    orgId: z.string().min(1),
    productCode: ProductCodeSchema,
    status: ProductAccessStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ProductAccessListResponseSchema = z
  .object({
    productAccess: z.array(ProductAccessSchema),
  })
  .strict();

export type ProductCode = z.infer<typeof ProductCodeSchema>;
export type ProductAccessStatus = z.infer<typeof ProductAccessStatusSchema>;
export type ProductAccess = z.infer<typeof ProductAccessSchema>;
export type ProductAccessListResponse = z.infer<
  typeof ProductAccessListResponseSchema
>;
