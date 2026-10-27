import { randomUUID } from "crypto";
import { z } from "zod";
import * as C from "@liass-ohada/shared/restaurants";
import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { RestaurantInventoryService as Inventory } from "./inventory-service";
import { RestaurantsService } from "./restaurant-service";
import { StockItem, StockMovement } from "./inventory-model";
import { INVENTORY_ROUTES } from "./inventory-routes";

export function quantityToMilli(raw: string): number {
  C.InventoryQuantitySchema.parse(raw);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace(/^[+-]/, "").split(".");
  const value =
    (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"))) *
    (negative ? -1n : 1n);
  if (
    value === 0n ||
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new AppError(400, "RESTAURANTS_INVENTORY_QUANTITY");
  return Number(value);
}
const itemResponse = ({ orgId: _org, outletId: _out, ...item }: StockItem) =>
  C.StockItemResponseDataSchema.parse({
    ...item,
    isNegativeStock: item.balanceMilli < 0,
  });
const movementResponse = ({
  orgId: _org,
  outletId: _out,
  ...movement
}: StockMovement) =>
  C.StockMovementResponseDataSchema.parse({
    ...movement,
    isNegativeStock: movement.resultingBalanceMilli < 0,
  });
export function inventoryHandler(
  operation: (typeof INVENTORY_ROUTES)[number]["operation"],
) {
  const route = INVENTORY_ROUTES.find((r) => r.operation === operation)!;
  const fields = {
    outletId: z.string().uuid(),
    ...(operation === "list" || operation === "create"
      ? {}
      : { stockItemId: z.string().uuid() }),
  };
  const command =
    operation === "create"
      ? C.CreateStockItemRequestSchema
      : operation === "update"
        ? C.UpdateStockItemRequestSchema
        : operation === "movement"
          ? C.ManualStockMovementRequestSchema
          : operation === "list" || operation === "history"
            ? C.InventoryListRequestSchema
            : z.object({}).strict();
  return createHandler(
    z.object({ ...command.shape, ...fields }).strict(),
    async (raw, context) => {
      const input = raw as Record<string, unknown>;
      const bodyInput: unknown = context.event.body
        ? JSON.parse(context.event.body)
        : {};
      const queryInput: unknown = context.event.queryStringParameters ?? {};
      // Validate each transport source independently: body/query may never supply route identity.
      const mutation = ["create", "update", "movement"].includes(operation);
      (mutation ? command : z.object({}).strict()).parse(bodyInput);
      (operation === "list" || operation === "history"
        ? C.InventoryListRequestSchema
        : z.object({}).strict()
      ).parse(queryInput);
      const outletId = z.string().uuid().parse(input.outletId);
      const scope = { orgId: context.orgId, outletId };
      // Canonical parent resolution also covers empty lists/history, rather than trusting a URL ID.
      await RestaurantsService.get(context.orgId, "outlet", {}, outletId);
      const { outletId: _out, stockItemId, ...body } = input;
      try {
        if (operation === "list") {
          const result = await Inventory.list(
            scope,
            C.InventoryListRequestSchema.parse(body),
          );
          return C.StockItemsResponseSchema.parse({
            ...result,
            items: result.items.map(itemResponse),
          });
        }
        if (operation === "create")
          return {
            data: itemResponse(
              await Inventory.create(scope, {
                id: randomUUID(),
                ...C.CreateStockItemRequestSchema.parse(body),
              }),
            ),
          };
        const id = z.string().uuid().parse(stockItemId);
        if (operation === "get")
          return { data: itemResponse(await Inventory.get(scope, id)) };
        if (operation === "update")
          return {
            data: itemResponse(
              await Inventory.update(
                scope,
                id,
                C.UpdateStockItemRequestSchema.parse(body),
              ),
            ),
          };
        await Inventory.get(scope, id);
        if (operation === "history") {
          const result = await Inventory.history(
            scope,
            id,
            C.InventoryListRequestSchema.parse(body),
          );
          return C.StockMovementsResponseSchema.parse({
            ...result,
            items: result.items.map(movementResponse),
          });
        }
        const request = C.ManualStockMovementRequestSchema.parse(body);
        const movement = await Inventory.applyMovement(scope, {
          stockItemId: id,
          type: request.type,
          quantityMilli: quantityToMilli(request.quantity),
          businessEventId: `MANUAL:${request.clientRequestId}`,
          sourceReference: request.sourceReference,
          source: "MANUAL",
          actorId: context.userId,
        });
        return { data: movementResponse(movement) };
      } catch (error) {
        if (
          error instanceof Error &&
          [
            "TransactionCanceledException",
            "TransactionConflictException",
          ].includes(error.name)
        )
          throw new AppError(409, "RESTAURANTS_INVENTORY_CONFLICT");
        throw error;
      }
    },
    {
      action: `${route.method} ${route.path}`,
      productCode: "RESTAURANTS",
      permission: "RESTAURANTS_SETUP_MANAGE",
    },
  );
}
