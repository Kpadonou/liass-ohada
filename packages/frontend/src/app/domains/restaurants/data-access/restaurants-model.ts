import * as c from '@liass-ohada/shared/restaurants';
import { z } from 'zod';
export const restaurantEntities = {
  restaurant: c.RestaurantSchema,
  outlet: c.OutletSchema,
  area: c.ServiceAreaSchema,
  table: c.RestaurantTableSchema,
  station: c.PreparationStationSchema,
  menu: c.MenuSchema,
  category: c.MenuCategorySchema,
  item: c.MenuItemSchema,
};
export type RestaurantKind = keyof typeof restaurantEntities;
export type RestaurantEntities = { [K in RestaurantKind]: z.infer<(typeof restaurantEntities)[K]> };
export type RestaurantEntity = RestaurantEntities[RestaurantKind];
export interface RestaurantContext {
  outletId?: string;
  areaId?: string;
  categoryId?: string;
}
export const createRequests = {
  restaurant: c.CreateRestaurantRequestSchema,
  outlet: c.CreateOutletRequestSchema,
  area: c.CreateServiceAreaRequestSchema,
  table: c.CreateRestaurantTableRequestSchema,
  station: c.CreatePreparationStationRequestSchema,
  menu: c.CreateMenuRequestSchema,
  category: c.CreateMenuCategoryRequestSchema,
  item: c.CreateMenuItemRequestSchema,
};
export const updateRequests = {
  restaurant: c.UpdateRestaurantRequestSchema,
  outlet: c.UpdateOutletRequestSchema,
  area: c.UpdateServiceAreaRequestSchema,
  table: c.UpdateRestaurantTableRequestSchema,
  station: c.UpdatePreparationStationRequestSchema,
  menu: c.UpdateMenuRequestSchema,
  category: c.UpdateMenuCategoryRequestSchema,
  item: c.UpdateMenuItemRequestSchema,
};
export const entityResponses = {
  restaurant: c.RestaurantResponseSchema,
  outlet: c.OutletResponseSchema,
  area: c.ServiceAreaResponseSchema,
  table: c.RestaurantTableResponseSchema,
  station: c.PreparationStationResponseSchema,
  menu: c.MenuResponseSchema,
  category: c.MenuCategoryResponseSchema,
  item: c.MenuItemResponseSchema,
};
export const listResponses = {
  outlet: c.OutletListResponseSchema,
  area: c.ServiceAreaListResponseSchema,
  table: c.RestaurantTableListResponseSchema,
  station: c.PreparationStationListResponseSchema,
  category: c.MenuCategoryListResponseSchema,
  item: c.MenuItemListResponseSchema,
};
export type RestaurantListKind = keyof typeof listResponses;
export function restaurantPath(
  kind: RestaurantKind,
  context: RestaurantContext,
  id?: string,
): string {
  const part = (value: string | undefined) => encodeURIComponent(c.RestaurantIdSchema.parse(value));
  let path = '/restaurants';
  if (kind === 'restaurant') return `${path}/restaurant`;
  if (kind === 'outlet') path += '/outlets';
  else {
    path += `/outlets/${part(context.outletId)}`;
    if (kind === 'area') path += '/service-areas';
    if (kind === 'station') path += '/preparation-stations';
    if (kind === 'table') path += `/service-areas/${part(context.areaId)}/tables`;
    if (kind === 'menu') return `${path}/menu`;
    if (kind === 'category') path += '/menu/categories';
    if (kind === 'item') path += `/menu/categories/${part(context.categoryId)}/items`;
  }
  return id ? `${path}/${part(id)}` : path;
}
