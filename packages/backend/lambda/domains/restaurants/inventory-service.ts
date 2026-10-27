import { randomUUID } from "crypto";
import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { InventoryRepository as R } from "./inventory-repository";
import { RestaurantsRepository } from "./restaurant-repository";
import { entitySK, entityTypes } from "./restaurant-model";
import { restaurantsTableName } from "./restaurant-storage";
import { transactionFingerprint as fingerprint } from "./transaction-repository";
import {
  InventoryScope,
  InventoryScopeSchema,
  StockItemSchema,
  StockUnitSchema,
  MovementInputSchema,
  StockMovementSchema,
  StockMappingSchema,
  InventoryReceiptSchema,
  movementDelta,
  discreteUnit,
  MilliSchema,
} from "./inventory-model";
const ITEM = "RESTAURANT_STOCK_ITEM",
  MOVEMENT = "RESTAURANT_STOCK_MOVEMENT",
  RECEIPT = "RESTAURANT_INVENTORY_COMMAND",
  MAPPING = "RESTAURANT_STOCK_MAPPING";
const conflict = (): never => {
  throw new AppError(409, "RESTAURANTS_INVENTORY_CONFLICT");
};
const retryable = (e: unknown) =>
  e instanceof Error &&
  ["TransactionCanceledException", "TransactionConflictException"].includes(
    e.name,
  );
/** Internal application boundary: callers must first verify membership, RESTAURANTS entitlement and OWNER/MANAGER management permission. Business-event callers are trusted product services. */
export class RestaurantInventoryService {
  static async get(scope: InventoryScope, id: string) {
    InventoryScopeSchema.parse(scope);
    z.string().uuid().parse(id);
    const item = await R.get(
      scope,
      R.itemKey(scope, id),
      ITEM,
      StockItemSchema,
    );
    if (
      !item ||
      item.orgId !== scope.orgId ||
      item.outletId !== scope.outletId ||
      item.id !== id
    )
      throw new AppError(404, "RESTAURANTS_INVENTORY_NOT_FOUND");
    return item;
  }
  static async create(scope: InventoryScope, raw: unknown) {
    InventoryScopeSchema.parse(scope);
    const input = z
      .object({
        id: z.string().uuid(),
        name: StockItemSchema.shape.name,
        unit: StockUnitSchema,
      })
      .strict()
      .parse(raw);
    const outlet = await RestaurantsRepository.get(
      scope.orgId,
      "outlet",
      {},
      scope.outletId,
    );
    if (!outlet) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const now = new Date().toISOString();
    const item = StockItemSchema.parse({
      ...scope,
      ...input,
      isActive: true,
      balanceMilli: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await R.commit([
      R.put(scope, R.itemKey(scope, item.id), ITEM, item),
      this.configurationCheck(
        scope,
        "outlet",
        {},
        scope.outletId,
        outlet.data.version,
      ),
    ]);
    return item;
  }
  static async update(scope: InventoryScope, id: string, raw: unknown) {
    const input = z
      .object({
        expectedVersion: z.number().int().positive(),
        name: StockItemSchema.shape.name.optional(),
        isActive: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    const old = await this.get(scope, id);
    if (old.version !== input.expectedVersion) return conflict();
    const item = StockItemSchema.parse({
      ...old,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      version: old.version + 1,
      updatedAt: new Date().toISOString(),
    });
    await R.commit([
      R.put(scope, R.itemKey(scope, id), ITEM, item, old.version),
    ]);
    return item;
  }
  static list(
    scope: InventoryScope,
    input: { limit?: number; cursor?: string } = {},
  ) {
    return R.list(
      scope,
      K.restaurantStockPK(scope.orgId, scope.outletId),
      K.restaurantStockPrefix(),
      ITEM,
      StockItemSchema,
      input,
    );
  }
  static history(
    scope: InventoryScope,
    id: string,
    input: { limit?: number; cursor?: string } = {},
  ) {
    z.string().uuid().parse(id);
    return R.list(
      scope,
      K.restaurantStockHistoryPK(scope.orgId, scope.outletId, id),
      K.restaurantStockMovementPrefix(),
      MOVEMENT,
      StockMovementSchema,
      input,
      true,
    );
  }
  static async applyMovement(scope: InventoryScope, raw: unknown) {
    InventoryScopeSchema.parse(scope);
    const input = MovementInputSchema.parse(raw);
    const eventHash = fingerprint(input.businessEventId ?? randomUUID());
    // Reuse Restaurants' durable command key and canonical intent fingerprint conventions; never TTL-dependent.
    const commandKey = {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        "INVENTORY",
        "NEW",
        eventHash,
      ),
      SK: K.restaurantTransactionCommandSK("NEW", eventHash),
    };
    const intent = fingerprint({
      ...input,
      quantityMilli:
        input.type === "ADJUSTMENT"
          ? input.quantityMilli
          : Math.abs(input.quantityMilli),
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      if (input.businessEventId) {
        const receipt = await R.get(
          scope,
          commandKey,
          RECEIPT,
          InventoryReceiptSchema,
        );
        if (receipt) {
          if (receipt.fingerprint !== intent) return conflict();
          return receipt.movement;
        }
      }
      const old = await this.get(scope, input.stockItemId);
      const deltaMilli = movementDelta(old.unit, input);
      const sum = BigInt(old.balanceMilli) + BigInt(deltaMilli);
      if (
        sum > BigInt(Number.MAX_SAFE_INTEGER) ||
        sum < BigInt(Number.MIN_SAFE_INTEGER)
      )
        return conflict();
      const balanceMilli = MilliSchema.parse(Number(sum));
      const now = new Date().toISOString();
      const { quantityMilli: _, ...metadata } = input;
      const movement = StockMovementSchema.parse({
        ...scope,
        ...metadata,
        id: randomUUID(),
        deltaMilli,
        resultingBalanceMilli: balanceMilli,
        createdAt: now,
      });
      const next = StockItemSchema.parse({
        ...old,
        balanceMilli,
        version: old.version + 1,
        updatedAt: now,
      });
      const actions = [
        R.put(scope, R.itemKey(scope, old.id), ITEM, next, old.version),
        R.put(
          scope,
          {
            PK: K.restaurantStockHistoryPK(scope.orgId, scope.outletId, old.id),
            SK: K.restaurantStockMovementSK(now, movement.id),
          },
          MOVEMENT,
          movement,
        ),
      ];
      if (input.businessEventId)
        actions.push(
          R.put(scope, commandKey, RECEIPT, { fingerprint: intent, movement }),
        );
      try {
        await R.commit(actions);
        return movement;
      } catch (e) {
        if (!retryable(e)) throw e;
        if (attempt === 7) {
          if (input.businessEventId) {
            const receipt = await R.get(
              scope,
              commandKey,
              RECEIPT,
              InventoryReceiptSchema,
            );
            if (receipt && receipt.fingerprint === intent)
              return receipt.movement;
          }
          throw e;
        }
      }
    }
    return conflict();
  }
  private static configurationCheck(
    scope: InventoryScope,
    kind: "outlet" | "item",
    parents: { outletId?: string; categoryId?: string },
    id: string,
    version: number,
  ) {
    return {
      ConditionCheck: {
        TableName: restaurantsTableName(),
        Key: marshall({
          PK: K.orgKey(scope.orgId),
          SK: entitySK(kind, parents, id),
        }),
        ConditionExpression:
          "orgId = :org AND entityType = :type AND #d.#v = :v",
        ExpressionAttributeNames: { "#d": "data", "#v": "version" },
        ExpressionAttributeValues: marshall({
          ":org": scope.orgId,
          ":type": entityTypes[kind],
          ":v": version,
        }),
      },
    };
  }
  static async mapMenuItem(scope: InventoryScope, raw: unknown) {
    InventoryScopeSchema.parse(scope);
    const input = z
      .object({
        menuItemId: z.string().uuid(),
        categoryId: z.string().uuid(),
        stockItemId: z.string().uuid(),
        actorId: z.string().min(1),
      })
      .strict()
      .parse(raw);
    const item = await this.get(scope, input.stockItemId);
    const menu = await RestaurantsRepository.get(
      scope.orgId,
      "item",
      { outletId: scope.outletId, categoryId: input.categoryId },
      input.menuItemId,
    );
    if (
      !menu ||
      menu.data.outletId !== scope.outletId ||
      menu.data.preparationStationId ||
      !discreteUnit(item.unit)
    )
      return conflict();
    const mapping = StockMappingSchema.parse({
      ...scope,
      ...input,
      createdAt: new Date().toISOString(),
    });
    await R.commit([
      R.put(
        scope,
        {
          PK: K.restaurantStockPK(scope.orgId, scope.outletId),
          SK: K.restaurantStockMappingSK(input.menuItemId),
        },
        MAPPING,
        mapping,
      ),
      this.configurationCheck(
        scope,
        "item",
        { outletId: scope.outletId, categoryId: input.categoryId },
        input.menuItemId,
        menu.data.version,
      ),
      {
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall(R.itemKey(scope, item.id)),
          ConditionExpression:
            "#d.#v = :v AND orgId = :org AND outletId = :out",
          ExpressionAttributeNames: { "#d": "data", "#v": "version" },
          ExpressionAttributeValues: marshall({
            ":v": item.version,
            ":org": scope.orgId,
            ":out": scope.outletId,
          }),
        },
      },
    ]);
    return mapping;
  }
  static resolveMapping(scope: InventoryScope, menuItemId: string) {
    InventoryScopeSchema.parse(scope);
    z.string().uuid().parse(menuItemId);
    return R.get(
      scope,
      {
        PK: K.restaurantStockPK(scope.orgId, scope.outletId),
        SK: K.restaurantStockMappingSK(menuItemId),
      },
      MAPPING,
      StockMappingSchema,
    );
  }
}
