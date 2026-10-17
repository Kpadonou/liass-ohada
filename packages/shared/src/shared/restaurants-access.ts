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
  "RESTAURANTS_STAFF_READ",
  "RESTAURANTS_STAFF_MANAGE",
] as const;
/** LR-TX-1 command vocabulary. Unscoped staff roles receive no mutation grants. */
export const RESTAURANTS_TRANSACTION_PERMISSIONS = [
  "RESTAURANTS_SESSION_READ",
  "RESTAURANTS_SESSION_OPEN_MANAGE",
  "RESTAURANTS_SESSION_CLOSE_MANAGE",
  "RESTAURANTS_SESSION_RESPONSIBILITY_MANAGE",
  "RESTAURANTS_ORDER_READ",
  "RESTAURANTS_ORDER_CREATE_MANAGE",
  "RESTAURANTS_ORDER_DRAFT_MANAGE",
  "RESTAURANTS_ORDER_SUBMIT_MANAGE",
  "RESTAURANTS_ORDER_CANCEL_MANAGE",
  "RESTAURANTS_ORDER_CLOSE_MANAGE",
] as const;
/** Service entry permissions still require server-side outlet/staff authorization. */
export const RESTAURANTS_SERVICE_PERMISSIONS = [
  "RESTAURANTS_SERVICE_FLOOR_READ",
  "RESTAURANTS_SERVICE_SESSION_OPEN_MANAGE",
  "RESTAURANTS_SERVICE_SESSION_READ",
  "RESTAURANTS_SERVICE_ORDER_READ",
  "RESTAURANTS_SERVICE_ORDER_CREATE_MANAGE",
  "RESTAURANTS_SERVICE_ORDER_DRAFT_MANAGE",
  "RESTAURANTS_SERVICE_ORDER_SUBMIT_MANAGE",
] as const;
export const RESTAURANTS_PREPARATION_PERMISSIONS = [
  "RESTAURANTS_PREPARATION_READ",
  "RESTAURANTS_PREPARATION_START_MANAGE",
  "RESTAURANTS_PREPARATION_READY_MANAGE",
  "RESTAURANTS_PREPARATION_SERVE_MANAGE",
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
