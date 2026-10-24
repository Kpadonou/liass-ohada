import { z } from "zod";
export * from "./guest";
export * from "./guest-carte";
export * from "./transactions";
export * from "./service-floor";
export * from "./staff";

export const RestaurantIdSchema = z.string().uuid();
export const RestaurantNameSchema = z.string().trim().min(1).max(160);
export const GuestOrderingPolicySchema = z.enum([
  "DISABLED",
  "STAFF_APPROVAL",
  "DIRECT",
]);
export const MenuItemAvailabilitySchema = z.enum(["AVAILABLE", "UNAVAILABLE"]);
export const RestaurantTableCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/);
export const RestaurantTableCapacitySchema = z
  .number()
  .int()
  .positive()
  .max(1000);
// Repository-wide money convention: exact integers in the smallest currency unit.
export const MenuPriceSchema = z
  .object({
    amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const RestaurantTableQrResponseSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

const metadata = {
  id: RestaurantIdSchema,
  name: RestaurantNameSchema,
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const RestaurantSchema = z
  .object({ ...metadata, guestOrderingPolicy: GuestOrderingPolicySchema })
  .strict();
export const OutletSchema = z
  .object({ ...metadata, restaurantId: RestaurantIdSchema })
  .strict();
export const ServiceAreaSchema = z
  .object({ ...metadata, outletId: RestaurantIdSchema })
  .strict();
export const RestaurantTableSchema = z
  .object({
    ...metadata,
    outletId: RestaurantIdSchema,
    serviceAreaId: RestaurantIdSchema,
    code: RestaurantTableCodeSchema,
    capacity: RestaurantTableCapacitySchema.optional(),
  })
  .strict();
export const PreparationStationSchema = z
  .object({ ...metadata, outletId: RestaurantIdSchema })
  .strict();
export const MenuSchema = z
  .object({
    ...metadata,
    outletId: RestaurantIdSchema,
    currency: MenuPriceSchema.shape.currency,
  })
  .strict();
export const MenuCategorySchema = z
  .object({
    ...metadata,
    outletId: RestaurantIdSchema,
    menuId: RestaurantIdSchema,
    position: z.number().int().nonnegative().max(10000).optional(),
  })
  .strict();
export const MenuItemSchema = z
  .object({
    ...metadata,
    outletId: RestaurantIdSchema,
    menuId: RestaurantIdSchema,
    categoryId: RestaurantIdSchema,
    price: MenuPriceSchema,
    availability: MenuItemAvailabilitySchema,
    preparationStationId: RestaurantIdSchema.optional(),
    guestReorderEnabled: z.boolean(),
  })
  .strict();

const create = {
  clientRequestId: z.string().uuid(),
  name: RestaurantNameSchema,
};
const update = {
  expectedVersion: metadata.version,
  name: RestaurantNameSchema.optional(),
};
const hasChange = (value: object) =>
  Object.keys(value).some((key) =>
    [
      "name",
      "guestOrderingPolicy",
      "isActive",
      "code",
      "capacity",
      "position",
      "price",
      "preparationStationId",
      "guestReorderEnabled",
    ].includes(key),
  );
export const CreateRestaurantRequestSchema = z
  .object({
    ...create,
    guestOrderingPolicy: GuestOrderingPolicySchema.default("STAFF_APPROVAL"),
  })
  .strict();
export const UpdateRestaurantRequestSchema = z
  .object({
    ...update,
    guestOrderingPolicy: GuestOrderingPolicySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(hasChange);
export const CreateOutletRequestSchema = z.object(create).strict();
export const UpdateOutletRequestSchema = z
  .object(update)
  .strict()
  .refine(hasChange);
export const CreateServiceAreaRequestSchema = z.object(create).strict();
export const UpdateServiceAreaRequestSchema = z
  .object(update)
  .strict()
  .refine(hasChange);
export const CreateRestaurantTableRequestSchema = z
  .object({
    ...create,
    code: RestaurantTableCodeSchema,
    capacity: RestaurantTableCapacitySchema.optional(),
  })
  .strict();
export const UpdateRestaurantTableRequestSchema = z
  .object({
    ...update,
    code: RestaurantTableCodeSchema.optional(),
    capacity: RestaurantTableCapacitySchema.nullable().optional(),
  })
  .strict()
  .refine(hasChange);
export const CreatePreparationStationRequestSchema = z.object(create).strict();
export const UpdatePreparationStationRequestSchema = z
  .object(update)
  .strict()
  .refine(hasChange);
export const CreateMenuRequestSchema = z
  .object({ ...create, currency: MenuPriceSchema.shape.currency })
  .strict();
export const UpdateMenuRequestSchema = z
  .object(update)
  .strict()
  .refine(hasChange);
export const CreateMenuCategoryRequestSchema = z
  .object({ ...create, position: MenuCategorySchema.shape.position })
  .strict();
export const UpdateMenuCategoryRequestSchema = z
  .object({ ...update, position: MenuCategorySchema.shape.position })
  .strict()
  .refine(hasChange);
export const CreateMenuItemRequestSchema = z
  .object({
    ...create,
    price: MenuPriceSchema,
    availability: MenuItemAvailabilitySchema.default("AVAILABLE"),
    preparationStationId: RestaurantIdSchema.optional(),
    guestReorderEnabled: z.boolean().default(false),
  })
  .strict();
export const UpdateMenuItemRequestSchema = z
  .object({
    ...update,
    price: MenuPriceSchema.optional(),
    preparationStationId: RestaurantIdSchema.nullable().optional(),
    guestReorderEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(hasChange);
export const ChangeMenuItemAvailabilityRequestSchema = z
  .object({
    expectedVersion: metadata.version,
    availability: MenuItemAvailabilitySchema,
  })
  .strict();
export const RestaurantsLifecycleRequestSchema = z
  .object({ expectedVersion: metadata.version })
  .strict();
export const RestaurantsListRequestSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict();

const responseMessage = {
  message: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .strict()
    .optional(),
};
export const RestaurantResponseSchema = z
  .object({ data: RestaurantSchema, ...responseMessage })
  .strict();
export const OutletResponseSchema = z
  .object({ data: OutletSchema, ...responseMessage })
  .strict();
export const ServiceAreaResponseSchema = z
  .object({ data: ServiceAreaSchema, ...responseMessage })
  .strict();
export const RestaurantTableResponseSchema = z
  .object({ data: RestaurantTableSchema, ...responseMessage })
  .strict();
export const PreparationStationResponseSchema = z
  .object({ data: PreparationStationSchema, ...responseMessage })
  .strict();
export const MenuResponseSchema = z
  .object({ data: MenuSchema, ...responseMessage })
  .strict();
export const MenuCategoryResponseSchema = z
  .object({ data: MenuCategorySchema, ...responseMessage })
  .strict();
export const MenuItemResponseSchema = z
  .object({ data: MenuItemSchema, ...responseMessage })
  .strict();
const page = { nextCursor: z.string().min(1).optional() };
export const OutletListResponseSchema = z
  .object({ items: z.array(OutletSchema), ...page })
  .strict();
export const ServiceAreaListResponseSchema = z
  .object({ items: z.array(ServiceAreaSchema), ...page })
  .strict();
export const RestaurantTableListResponseSchema = z
  .object({ items: z.array(RestaurantTableSchema), ...page })
  .strict();
export const PreparationStationListResponseSchema = z
  .object({ items: z.array(PreparationStationSchema), ...page })
  .strict();
export const MenuCategoryListResponseSchema = z
  .object({ items: z.array(MenuCategorySchema), ...page })
  .strict();
export const MenuItemListResponseSchema = z
  .object({ items: z.array(MenuItemSchema), ...page })
  .strict();

export type Restaurant = z.infer<typeof RestaurantSchema>;
export type Outlet = z.infer<typeof OutletSchema>;
export type ServiceArea = z.infer<typeof ServiceAreaSchema>;
export type RestaurantTable = z.infer<typeof RestaurantTableSchema>;
export type PreparationStation = z.infer<typeof PreparationStationSchema>;
export type Menu = z.infer<typeof MenuSchema>;
export type MenuCategory = z.infer<typeof MenuCategorySchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
export type GuestOrderingPolicy = z.infer<typeof GuestOrderingPolicySchema>;
export type MenuItemAvailability = z.infer<typeof MenuItemAvailabilitySchema>;

export type RestaurantTableQrResponse = z.infer<
  typeof RestaurantTableQrResponseSchema
>;
export type CreateRestaurantRequest = z.infer<
  typeof CreateRestaurantRequestSchema
>;
export type UpdateRestaurantRequest = z.infer<
  typeof UpdateRestaurantRequestSchema
>;
export type CreateOutletRequest = z.infer<typeof CreateOutletRequestSchema>;
export type UpdateOutletRequest = z.infer<typeof UpdateOutletRequestSchema>;
export type CreateServiceAreaRequest = z.infer<
  typeof CreateServiceAreaRequestSchema
>;
export type UpdateServiceAreaRequest = z.infer<
  typeof UpdateServiceAreaRequestSchema
>;
export type CreateRestaurantTableRequest = z.infer<
  typeof CreateRestaurantTableRequestSchema
>;
export type UpdateRestaurantTableRequest = z.infer<
  typeof UpdateRestaurantTableRequestSchema
>;
export type CreatePreparationStationRequest = z.infer<
  typeof CreatePreparationStationRequestSchema
>;
export type UpdatePreparationStationRequest = z.infer<
  typeof UpdatePreparationStationRequestSchema
>;
export type CreateMenuRequest = z.infer<typeof CreateMenuRequestSchema>;
export type UpdateMenuRequest = z.infer<typeof UpdateMenuRequestSchema>;
export type CreateMenuCategoryRequest = z.infer<
  typeof CreateMenuCategoryRequestSchema
>;
export type UpdateMenuCategoryRequest = z.infer<
  typeof UpdateMenuCategoryRequestSchema
>;
export type CreateMenuItemRequest = z.infer<typeof CreateMenuItemRequestSchema>;
export type UpdateMenuItemRequest = z.infer<typeof UpdateMenuItemRequestSchema>;
export type ChangeMenuItemAvailabilityRequest = z.infer<
  typeof ChangeMenuItemAvailabilityRequestSchema
>;
export type RestaurantsLifecycleRequest = z.infer<
  typeof RestaurantsLifecycleRequestSchema
>;
export type RestaurantsListRequest = z.infer<
  typeof RestaurantsListRequestSchema
>;
export type RestaurantResponse = z.infer<typeof RestaurantResponseSchema>;
export type OutletResponse = z.infer<typeof OutletResponseSchema>;
export type ServiceAreaResponse = z.infer<typeof ServiceAreaResponseSchema>;
export type RestaurantTableResponse = z.infer<
  typeof RestaurantTableResponseSchema
>;
export type PreparationStationResponse = z.infer<
  typeof PreparationStationResponseSchema
>;
export type MenuResponse = z.infer<typeof MenuResponseSchema>;
export type MenuCategoryResponse = z.infer<typeof MenuCategoryResponseSchema>;
export type MenuItemResponse = z.infer<typeof MenuItemResponseSchema>;
export type OutletListResponse = z.infer<typeof OutletListResponseSchema>;
export type ServiceAreaListResponse = z.infer<
  typeof ServiceAreaListResponseSchema
>;
export type RestaurantTableListResponse = z.infer<
  typeof RestaurantTableListResponseSchema
>;
export type PreparationStationListResponse = z.infer<
  typeof PreparationStationListResponseSchema
>;
export type MenuCategoryListResponse = z.infer<
  typeof MenuCategoryListResponseSchema
>;
export type MenuItemListResponse = z.infer<typeof MenuItemListResponseSchema>;
export * from "./preparation";

/** Shared local/server matching; display names are never rewritten. */
export function normalizeMenuItemSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function matchesMenuItemSearch(name: string, query: string): boolean {
  const words = normalizeMenuItemSearch(name).split(" ");
  return normalizeMenuItemSearch(query)
    .split(" ")
    .filter(Boolean)
    .every((token) => words.some((word) => word.startsWith(token)));
}
export const MenuItemsBrowseRequestSchema = RestaurantsListRequestSchema.extend(
  {
    q: z
      .string()
      .max(160)
      .transform(normalizeMenuItemSearch)
      .refine((value) => !value || value.length >= 2)
      .optional(),
  },
).strict();
export const OperationalMenuItemSchema = MenuItemSchema.pick({
  id: true,
  name: true,
  outletId: true,
  menuId: true,
  categoryId: true,
  version: true,
  price: true,
  availability: true,
})
  .extend({ categoryName: RestaurantNameSchema })
  .strict();
/** A page can be empty while nextCursor remains: no exhaustive no-match conclusion yet. */
export const MenuItemsBrowseResponseSchema = z
  .object({
    outletId: RestaurantIdSchema,
    menuId: RestaurantIdSchema,
    items: z.array(OperationalMenuItemSchema).max(100),
    nextCursor: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type MenuItemsBrowseRequest = z.infer<
  typeof MenuItemsBrowseRequestSchema
>;

export * from "./payments";

export * from "./receipts";

export * from "./waiter-call";
