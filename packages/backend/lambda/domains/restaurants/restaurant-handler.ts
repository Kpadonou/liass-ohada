import { z } from "zod";
import {
  ChangeMenuItemAvailabilityRequestSchema,
  RestaurantIdSchema,
  RestaurantsLifecycleRequestSchema,
  RestaurantsListRequestSchema,
} from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  createSchemas,
  entitySchemas,
  RestaurantParents,
  updateSchemas,
} from "./restaurant-model";
import { RESTAURANTS_ROUTES } from "./restaurant-routes";
import { RestaurantsService } from "./restaurant-service";

export function restaurantsHandler(name: string) {
  const route = RESTAURANTS_ROUTES.find((candidate) => candidate.name === name);
  if (!route) throw new Error("Unknown RESTAURANTS route");
  const pathFields: Record<string, typeof RestaurantIdSchema> = {};
  for (const match of route.path.matchAll(/\{(\w+)\}/g))
    pathFields[match[1]] = RestaurantIdSchema;
  const command =
    route.operation === "create"
      ? createSchemas[route.kind]
      : route.operation === "update"
        ? updateSchemas[route.kind]
        : route.operation === "deactivate"
          ? RestaurantsLifecycleRequestSchema
          : route.operation === "availability"
            ? ChangeMenuItemAvailabilityRequestSchema
            : route.operation === "list"
              ? RestaurantsListRequestSchema
              : z.object({}).strict();
  // Requests remain strict; the service validates the command again without route parameters.
  const requestSchema = z.object({ ...command.shape, ...pathFields }).strict();
  return createHandler(
    requestSchema,
    async (request, { orgId, userId, i18n }) => {
      const input: Record<string, unknown> = { ...request };
      const parents: RestaurantParents = {};
      for (const field of [
        "outletId",
        "serviceAreaId",
        "categoryId",
      ] as const) {
        if (pathFields[field] && field !== `${route.kind}Id`)
          parents[field] = RestaurantIdSchema.parse(input[field]);
      }
      const targetField: Record<string, string> = {
        outlet: "outletId",
        serviceArea: "serviceAreaId",
        table: "tableId",
        station: "stationId",
        category: "categoryId",
        item: "itemId",
      };
      const idField = targetField[route.kind];
      const id =
        idField &&
        pathFields[idField] &&
        route.operation !== "list" &&
        route.operation !== "create"
          ? RestaurantIdSchema.parse(input[idField])
          : undefined;
      // Parent IDs come only from validated route context, never mutable request attributes.
      for (const field of Object.keys(pathFields)) delete input[field];
      if (route.operation === "list")
        return RestaurantsService.list(orgId, route.kind, parents, input);
      if (route.operation === "qr")
        return RestaurantsService.getTableQr(
          orgId,
          parents,
          RestaurantIdSchema.parse(id),
        );
      const data =
        route.operation === "get"
          ? await RestaurantsService.get(orgId, route.kind, parents, id)
          : route.operation === "create"
            ? await RestaurantsService.create(
                orgId,
                userId,
                route.kind,
                parents,
                input,
              )
            : await RestaurantsService.update(
                orgId,
                userId,
                route.kind,
                parents,
                id,
                input,
                route.operation,
              );
      return {
        ...(route.operation === "get"
          ? {}
          : {
              message: i18n.getMessage(
                "SUCCESS_RESTAURANTS_CONFIGURATION_SAVED",
              ),
            }),
        data: entitySchemas[route.kind].parse(data),
      };
    },
    {
      action: `${route.method} ${route.path}`,
      productCode: "RESTAURANTS",
      permission: route.permission,
    },
  );
}
