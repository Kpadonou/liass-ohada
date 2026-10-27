import { randomUUID } from "crypto";
import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import * as C from "@liass-ohada/shared/restaurants";
import { InventoryRepository as R } from "./inventory-repository";
import { RestaurantInventoryService as Inventory } from "./inventory-service";
import { RestaurantsService } from "./restaurant-service";
import {
  InventoryScope,
  StockItemSchema,
  StockMappingSchema,
  discreteUnit,
} from "./inventory-model";
import { entitySK, entityTypes } from "./restaurant-model";
import { restaurantsTableName } from "./restaurant-storage";
import { transactionFingerprint as fingerprint } from "./transaction-repository";

const mappingType = "RESTAURANT_STOCK_MAPPING";
const receiptType = "RESTAURANT_INVENTORY_TRACKING_COMMAND";
const receiptSchema = z
  .object({ orgId: z.string(), outletId: z.string(), fingerprint: z.string() })
  .strict();
const conflict = (): never => {
  throw new AppError(409, "RESTAURANTS_INVENTORY_CONFLICT");
};
export class InventoryTrackingService {
  static key(scope: InventoryScope, menuItemId: string) {
    return {
      PK: K.restaurantStockPK(scope.orgId, scope.outletId),
      SK: K.restaurantStockMappingSK(menuItemId),
    };
  }
  static mapping(scope: InventoryScope, menuItemId: string) {
    return R.get(
      scope,
      this.key(scope, menuItemId),
      mappingType,
      StockMappingSchema,
    );
  }
  static async menu(
    scope: InventoryScope,
    categoryId: string,
    menuItemId: string,
  ) {
    const item = await RestaurantsService.get(
      scope.orgId,
      "item",
      { outletId: scope.outletId, categoryId },
      menuItemId,
    );
    if (
      item.outletId !== scope.outletId ||
      item.categoryId !== categoryId ||
      item.id !== menuItemId
    )
      throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    return item;
  }
  static async read(
    scope: InventoryScope,
    categoryId: string,
    menuItemId: string,
  ) {
    await this.menu(scope, categoryId, menuItemId);
    const mapping = await this.mapping(scope, menuItemId);
    const item =
      mapping && !mapping.removed
        ? await Inventory.get(scope, mapping.stockItemId)
        : null;
    const stockItem =
      item &&
      C.StockItemResponseDataSchema.parse({
        id: item.id,
        name: item.name,
        unit: item.unit,
        isActive: item.isActive,
        balanceMilli: item.balanceMilli,
        isNegativeStock: item.balanceMilli < 0,
        version: item.version,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    return { menuItemId, version: mapping?.version ?? 0, stockItem };
  }
  static async save(
    scope: InventoryScope,
    menuItemId: string,
    actorId: string,
    raw: unknown,
    remove = false,
  ) {
    z.string().uuid().parse(menuItemId);
    const save = remove
      ? undefined
      : C.SaveInventoryTrackingRequestSchema.parse(raw);
    const input = save ?? C.RemoveInventoryTrackingRequestSchema.parse(raw);
    const menu = await this.menu(scope, input.categoryId, menuItemId);
    const commandHash = fingerprint(input.clientRequestId);
    const commandKey = {
      PK: K.restaurantTransactionCommandPK(
        scope.orgId,
        scope.outletId,
        "INVENTORY_TRACKING",
        menuItemId,
        commandHash,
      ),
      SK: K.restaurantTransactionCommandSK(menuItemId, commandHash),
    };
    const intent = fingerprint({ ...input, remove, menuItemId, actorId });
    const replay = async () => {
      const receipt = await R.get(
        scope,
        commandKey,
        receiptType,
        receiptSchema,
      );
      if (!receipt) return false;
      if (receipt.fingerprint !== intent) return conflict();
      return true;
    };
    if (await replay()) return this.read(scope, input.categoryId, menuItemId);
    const old = await this.mapping(scope, menuItemId);
    if ((old?.version ?? 0) !== input.expectedVersion) return conflict();
    if (!remove && menu.preparationStationId)
      throw new AppError(400, "RESTAURANTS_INVENTORY_TRACKING_INELIGIBLE");
    const now = new Date().toISOString();
    const create = save?.mode === "CREATE";
    const target =
      save?.mode === "CREATE"
        ? StockItemSchema.parse({
            ...scope,
            id: randomUUID(),
            name: menu.name,
            unit: save.unit,
            isActive: true,
            balanceMilli: 0,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
        : save?.mode === "LINK"
          ? await Inventory.get(scope, save.stockItemId)
          : undefined;
    if (!remove && (!target || !target.isActive || !discreteUnit(target.unit)))
      throw new AppError(400, "RESTAURANTS_INVENTORY_TRACKING_TARGET");
    if (remove && (!old || old.removed)) return conflict();
    const mapping = StockMappingSchema.parse({
      ...scope,
      menuItemId,
      categoryId: input.categoryId,
      stockItemId: target?.id ?? old!.stockItemId,
      actorId,
      version: (old?.version ?? 0) + 1,
      removed: remove,
      createdAt: now,
    });
    const actions = [
      R.put(
        scope,
        this.key(scope, menuItemId),
        mappingType,
        mapping,
        old?.version,
      ),
      {
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall({
            PK: K.orgKey(scope.orgId),
            SK: entitySK(
              "item",
              { outletId: scope.outletId, categoryId: input.categoryId },
              menuItemId,
            ),
          }),
          ConditionExpression:
            "orgId = :org AND entityType = :type AND #d.#v = :v",
          ExpressionAttributeNames: { "#d": "data", "#v": "version" },
          ExpressionAttributeValues: marshall({
            ":org": scope.orgId,
            ":type": entityTypes.item,
            ":v": menu.version,
          }),
        },
      },
      R.put(scope, commandKey, receiptType, { ...scope, fingerprint: intent }),
    ];
    if (target) {
      if (create)
        actions.push(
          R.put(
            scope,
            R.itemKey(scope, target.id),
            "RESTAURANT_STOCK_ITEM",
            target,
          ),
        );
      else
        actions.push({
          ConditionCheck: {
            TableName: restaurantsTableName(),
            Key: marshall(R.itemKey(scope, target.id)),
            ConditionExpression:
              "orgId = :org AND outletId = :out AND entityType = :type AND #d.#v = :v",
            ExpressionAttributeNames: { "#d": "data", "#v": "version" },
            ExpressionAttributeValues: marshall({
              ":org": scope.orgId,
              ":out": scope.outletId,
              ":type": "RESTAURANT_STOCK_ITEM",
              ":v": target.version,
            }),
          },
        });
    }
    try {
      await R.commit(actions);
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "TransactionCanceledException",
          "TransactionConflictException",
        ].includes(error.name)
      ) {
        if (await replay())
          return this.read(scope, input.categoryId, menuItemId);
        return conflict();
      }
      throw error;
    }
    return this.read(scope, input.categoryId, menuItemId);
  }
}
