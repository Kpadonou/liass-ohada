import { z } from "zod";
import * as contracts from "@liass-ohada/shared/restaurants";
import { KeyFactory } from "@/lambda/shared/key-builder";

export const entitySchemas = {
  restaurant: contracts.RestaurantSchema,
  outlet: contracts.OutletSchema,
  serviceArea: contracts.ServiceAreaSchema,
  table: contracts.RestaurantTableSchema,
  station: contracts.PreparationStationSchema,
  menu: contracts.MenuSchema,
  category: contracts.MenuCategorySchema,
  item: contracts.MenuItemSchema,
};
export type RestaurantKind = keyof typeof entitySchemas;
export type RestaurantEntities = {
  [K in RestaurantKind]: z.infer<(typeof entitySchemas)[K]>;
};
export type RestaurantEntity = RestaurantEntities[RestaurantKind];
export interface RestaurantParents {
  outletId?: string;
  serviceAreaId?: string;
  categoryId?: string;
}
export const entityTypes: Record<RestaurantKind, string> = {
  restaurant: "RESTAURANT",
  outlet: "RESTAURANT_OUTLET",
  serviceArea: "RESTAURANT_SERVICE_AREA",
  table: "RESTAURANT_TABLE",
  station: "RESTAURANT_PREPARATION_STATION",
  menu: "RESTAURANT_MENU",
  category: "RESTAURANT_MENU_CATEGORY",
  item: "RESTAURANT_MENU_ITEM",
};
const requiredId = (value: string | undefined) =>
  contracts.RestaurantIdSchema.parse(value);
export function entitySK(
  kind: RestaurantKind,
  parents: RestaurantParents,
  id?: string,
): string {
  switch (kind) {
    case "restaurant":
      return KeyFactory.restaurantSK();
    case "outlet":
      return KeyFactory.restaurantOutletSK(requiredId(id));
    case "serviceArea":
      return KeyFactory.restaurantServiceAreaSK(
        requiredId(parents.outletId),
        requiredId(id),
      );
    case "table":
      return KeyFactory.restaurantTableSK(
        requiredId(parents.outletId),
        requiredId(parents.serviceAreaId),
        requiredId(id),
      );
    case "station":
      return KeyFactory.restaurantStationSK(
        requiredId(parents.outletId),
        requiredId(id),
      );
    case "menu":
      return KeyFactory.restaurantMenuSK(requiredId(parents.outletId));
    case "category":
      return KeyFactory.restaurantCategorySK(
        requiredId(parents.outletId),
        requiredId(id),
      );
    case "item":
      return KeyFactory.restaurantMenuItemSK(
        requiredId(parents.outletId),
        requiredId(parents.categoryId),
        requiredId(id),
      );
  }
}
export function collectionPrefix(
  kind: RestaurantKind,
  parents: RestaurantParents,
): string {
  switch (kind) {
    case "outlet":
      return KeyFactory.restaurantOutletPrefix();
    case "serviceArea":
      return KeyFactory.restaurantServiceAreaPrefix(
        requiredId(parents.outletId),
      );
    case "table":
      return KeyFactory.restaurantTablePrefix(
        requiredId(parents.outletId),
        requiredId(parents.serviceAreaId),
      );
    case "station":
      return KeyFactory.restaurantStationPrefix(requiredId(parents.outletId));
    case "category":
      return KeyFactory.restaurantCategoryPrefix(requiredId(parents.outletId));
    case "item":
      return KeyFactory.restaurantMenuItemPrefix(
        requiredId(parents.outletId),
        requiredId(parents.categoryId),
      );
    default:
      throw new Error("Singleton configurations cannot be listed");
  }
}
export const createSchemas = {
  restaurant: contracts.CreateRestaurantRequestSchema,
  outlet: contracts.CreateOutletRequestSchema,
  serviceArea: contracts.CreateServiceAreaRequestSchema,
  table: contracts.CreateRestaurantTableRequestSchema,
  station: contracts.CreatePreparationStationRequestSchema,
  menu: contracts.CreateMenuRequestSchema,
  category: contracts.CreateMenuCategoryRequestSchema,
  item: contracts.CreateMenuItemRequestSchema,
};
export const updateSchemas = {
  restaurant: contracts.UpdateRestaurantRequestSchema,
  outlet: contracts.UpdateOutletRequestSchema,
  serviceArea: contracts.UpdateServiceAreaRequestSchema,
  table: contracts.UpdateRestaurantTableRequestSchema,
  station: contracts.UpdatePreparationStationRequestSchema,
  menu: contracts.UpdateMenuRequestSchema,
  category: contracts.UpdateMenuCategoryRequestSchema,
  item: contracts.UpdateMenuItemRequestSchema,
};
