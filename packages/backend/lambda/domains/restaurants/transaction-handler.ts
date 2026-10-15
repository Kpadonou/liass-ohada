import { RestaurantServiceAccess } from "./service-access";
import { ResponsibleStaff } from "./responsible-staff";
import { z } from "zod";
import * as contracts from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RESTAURANT_TRANSACTION_ROUTES } from "./transaction-routes";
import {
  RestaurantTransactionsService,
  transactionRequestSchemas,
} from "./transaction-service";
import { RestaurantTransactionQueries } from "./transaction-queries";

export function restaurantTransactionHandler(name: string) {
  const route = RESTAURANT_TRANSACTION_ROUTES.find((r) => r.name === name);
  if (!route) throw new Error("Unknown Restaurants transaction route");
  const path: Record<string, typeof contracts.RestaurantIdSchema> = {};
  for (const match of route.path.matchAll(/\{(\w+)\}/g))
    path[match[1]] = contracts.RestaurantIdSchema;
  const command = "command" in route ? route.command : undefined;
  const query = "query" in route ? route.query : undefined;
  const fields = command
    ? transactionRequestSchemas[command].shape
    : query?.endsWith("HISTORY")
      ? contracts.RestaurantTransactionHistoryRequestSchema.shape
      : ["GET_SESSION", "GET_ORDER", "ACTIVE_TABLE"].includes(query ?? "")
        ? {}
        : contracts.RestaurantTransactionListRequestSchema.shape;
  return createHandler(
    z.object({ ...fields, ...path }).strict(),
    async (request, context) => {
      const input: Record<string, unknown> = { ...request };
      const scope = {
        orgId: context.orgId,
        outletId: contracts.RestaurantIdSchema.parse(input.outletId),
      };
      const ids: {
        sessionId?: string;
        orderId?: string;
        itemId?: string;
        tableId?: string;
      } = {};
      for (const key of ["sessionId", "orderId", "itemId", "tableId"] as const)
        if (path[key])
          ids[key] = contracts.RestaurantIdSchema.parse(input[key]);
      for (const key of Object.keys(path)) delete input[key];
      if (command) {
        const result = await RestaurantTransactionsService.mutate(
          { ...scope, actorId: context.userId },
          command,
          input,
          ids,
        );
        return [
          "OPEN_SESSION",
          "CLOSE_SESSION",
          "REPLACE_RESPONSIBLE_STAFF",
        ].includes(command)
          ? contracts.GuestSessionResponseSchema.parse({
              data: (
                await ResponsibleStaff.sessions(scope, [
                  contracts.GuestSessionSchema.parse(result.data),
                ])
              )[0],
            })
          : ["ADD_ITEM", "EDIT_ITEM", "CANCEL_ITEM"].includes(command)
            ? contracts.RestaurantOrderItemResponseSchema.parse(result)
            : contracts.RestaurantOrderResponseSchema.parse(result);
      }
      if (!query) throw new Error("Missing Restaurants query");
      if (query === "SERVICE_FLOOR")
        await RestaurantServiceAccess.authorize(scope, context.userId);
      const result = await RestaurantTransactionQueries.run(
        scope,
        query,
        input,
        ids,
      );
      if (query === "SERVICE_FLOOR")
        return contracts.RestaurantServiceFloorResponseSchema.parse(result);
      if (query === "GET_SESSION")
        return contracts.GuestSessionResponseSchema.parse(result);
      if (query === "GET_ORDER")
        return contracts.RestaurantOrderResponseSchema.parse(result);
      if (query === "ACTIVE_TABLE")
        return contracts.ActiveTableGuestSessionResponseSchema.parse(result);
      if (query === "ORDER_ITEMS")
        return contracts.RestaurantOrderItemListResponseSchema.parse(result);
      return [
        "ACTIVE_SESSIONS",
        "SESSION_HISTORY",
        "TABLE_SESSION_HISTORY",
      ].includes(query)
        ? contracts.GuestSessionListResponseSchema.parse(result)
        : contracts.RestaurantOrderListResponseSchema.parse(result);
    },
    {
      permission: route.permission,
      productCode: "RESTAURANTS",
      action: route.name,
    },
  );
}
