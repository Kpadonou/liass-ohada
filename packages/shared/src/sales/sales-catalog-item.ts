import { z } from "zod";

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().trim().min(1).max(maxLength).optional(),
  );

export const SalesCatalogItemTypeSchema = z.enum(["PRODUCT", "SERVICE"]);

const mutableSalesCatalogItemFields = {
  itemType: SalesCatalogItemTypeSchema,
  name: z.string().trim().min(1).max(160),
  description: optionalTrimmedString(2000),
  unit: optionalTrimmedString(80),
};

export const SalesCatalogItemSchema = z
  .object({
    id: z.string().min(1),
    ...mutableSalesCatalogItemFields,
    isActive: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const CreateSalesCatalogItemRequestSchema = z
  .object(mutableSalesCatalogItemFields)
  .strict();

export const UpdateSalesCatalogItemRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    itemType: mutableSalesCatalogItemFields.itemType.optional(),
    name: mutableSalesCatalogItemFields.name.optional(),
    description: mutableSalesCatalogItemFields.description,
    unit: mutableSalesCatalogItemFields.unit,
  })
  .strict()
  .refine(
    (request) =>
      Object.keys(request).some((field) => field !== "expectedVersion"),
    { message: "At least one catalog item field is required" },
  );

export const SalesCatalogItemIdRequestSchema = z
  .object({ itemId: z.string().trim().min(1).max(200) })
  .strict();

export const SalesCatalogItemLifecycleRequestSchema =
  SalesCatalogItemIdRequestSchema.extend({
    expectedVersion: z.number().int().positive(),
  }).strict();

export const ListSalesCatalogItemsRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const SalesCatalogItemListResponseSchema = z
  .object({
    items: z.array(SalesCatalogItemSchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type SalesCatalogItemType = z.infer<
  typeof SalesCatalogItemTypeSchema
>;
export type SalesCatalogItem = z.infer<typeof SalesCatalogItemSchema>;
export type CreateSalesCatalogItemRequest = z.infer<
  typeof CreateSalesCatalogItemRequestSchema
>;
export type UpdateSalesCatalogItemRequest = z.infer<
  typeof UpdateSalesCatalogItemRequestSchema
>;
export type SalesCatalogItemLifecycleRequest = z.infer<
  typeof SalesCatalogItemLifecycleRequestSchema
>;
export type ListSalesCatalogItemsRequest = z.infer<
  typeof ListSalesCatalogItemsRequestSchema
>;
export type SalesCatalogItemListResponse = z.infer<
  typeof SalesCatalogItemListResponseSchema
>;
