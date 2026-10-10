import { z } from "zod";

/** RESTO-0 vocabulary only; business permissions belong to later phases. */
export const RESTAURANTS_ROLES = [
  "OWNER",
  "MANAGER",
  "WAITER",
  "CASHIER",
  "KITCHEN",
] as const;
export const RestaurantsRoleSchema = z.enum(RESTAURANTS_ROLES);
export type RestaurantsRole = z.infer<typeof RestaurantsRoleSchema>;

/** Optional assignment on the existing USER_ORG_ACCESS; independent from its global role. */
export const ProductRolesSchema = z
  .object({
    RESTAURANTS: RestaurantsRoleSchema.optional(),
  })
  .strict();
export type ProductRoles = z.infer<typeof ProductRolesSchema>;
