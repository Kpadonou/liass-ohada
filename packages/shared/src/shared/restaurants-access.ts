import { z } from "zod";

/** Independent RESTAURANTS role vocabulary established by RESTO-0. */
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

/** Canonical RESTO-1 projection shared by server authorization and UI capabilities. */
export const RESTAURANTS_PERMISSIONS = [
  "RESTAURANTS_READ",
  "RESTAURANTS_SETUP_MANAGE",
  "RESTAURANTS_MENU_READ",
  "RESTAURANTS_MENU_MANAGE",
] as const;
export function restaurantsPermissionsForRole(
  role: unknown,
): readonly (typeof RESTAURANTS_PERMISSIONS)[number][] {
  const parsed = RestaurantsRoleSchema.safeParse(role);
  if (!parsed.success) return [];
  return parsed.data === "OWNER" || parsed.data === "MANAGER"
    ? RESTAURANTS_PERMISSIONS
    : ["RESTAURANTS_READ", "RESTAURANTS_MENU_READ"];
}
