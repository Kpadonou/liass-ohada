import { z } from "zod";
import { RestaurantOrderItem } from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { marshall } from "@aws-sdk/util-dynamodb";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { AppError } from "@/lambda/shared/app-error";
import { restaurantsTableName } from "./restaurant-storage";
import { InventoryTrackingService } from "./inventory-tracking-service";
import { InventoryEffects } from "./inventory-effects";
import {
  inventorySaleEventId,
  InventoryEffectReference,
} from "./inventory-effect-model";
import { RestaurantTransactionsRepository as R } from "./transaction-repository";
import {
  InventorySaleTargetSchema,
  TransactionScope,
  TransactionSchemas,
} from "./transaction-model";

type Target = z.infer<typeof InventorySaleTargetSchema>;
/** Restaurants-owned durable continuation. Commercial acceptance never depends on balance/lifecycle. */
export class InventorySales {
  static eventId(
    scope: TransactionScope,
    orderId: string,
    submissionId: string,
    stockItemId: string,
    type = "SALE",
  ) {
    // Orders can accept several batches. Submission identity distinguishes real later sales from replays.
    return inventorySaleEventId(
      scope,
      orderId,
      submissionId,
      stockItemId,
      type,
    );
  }

  static async capture(
    scope: TransactionScope,
    lines: {
      itemId: string;
      menuItemId: string;
      categoryId: string;
      quantity: number;
      stationId?: string;
    }[],
  ) {
    scope = { orgId: scope.orgId, outletId: scope.outletId };
    const targets = new Map<string, Target>();
    const actions: TransactWriteItem[] = [];
    for (const menuItemId of new Set(
      lines.filter((l) => !l.stationId).map((l) => l.menuItemId),
    )) {
      const mapping = await InventoryTrackingService.mapping(scope, menuItemId);
      const key = InventoryTrackingService.key(scope, menuItemId);
      actions.push({
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall(key),
          ...(mapping
            ? {
                ConditionExpression:
                  "orgId = :org AND outletId = :out AND entityType = :type AND (#d.#v = :v" +
                  (mapping.version === 1
                    ? " OR attribute_not_exists(#d.#v)"
                    : "") +
                  ") AND #d.#target = :target AND #d.#created = :created",
                ExpressionAttributeNames: {
                  "#d": "data",
                  "#v": "version",
                  "#target": "stockItemId",
                  "#created": "createdAt",
                },
                ExpressionAttributeValues: marshall({
                  ":org": scope.orgId,
                  ":out": scope.outletId,
                  ":type": "RESTAURANT_STOCK_MAPPING",
                  ":v": mapping.version,
                  ":target": mapping.stockItemId,
                  ":created": mapping.createdAt,
                }),
              }
            : { ConditionExpression: "attribute_not_exists(PK)" }),
        },
      });
      if (!mapping || mapping.removed) continue;
      for (const line of lines.filter(
        (l) => l.menuItemId === menuItemId && !l.stationId,
      )) {
        if (mapping.categoryId !== line.categoryId)
          throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
        const target = targets.get(mapping.stockItemId) ?? {
          stockItemId: mapping.stockItemId,
          lines: [],
        };
        target.lines.push({
          itemId: line.itemId,
          menuItemId,
          quantity: line.quantity,
        });
        targets.set(mapping.stockItemId, target);
      }
    }
    return {
      actions,
      targets: [...targets.values()].map((t) =>
        InventorySaleTargetSchema.parse(t),
      ),
    };
  }

  /** Reverse only canonical accepted quantities, using their original captured targets, never today's mapping. */
  static async reversal(
    scope: TransactionScope,
    orderId: string,
    lines: RestaurantOrderItem[],
  ) {
    const targets = new Map<string, Target>();
    const originals = new Set<string>();
    const dependencies: InventoryEffectReference[] = [];
    const originalEvents: Record<string, string[]> = {};
    for (const submissionId of new Set(
      lines.flatMap((l) =>
        l.status === "ACCEPTED" && l.snapshot ? [l.snapshot.submissionId] : [],
      ),
    )) {
      const raw = await R.get(
        scope,
        {
          PK: K.restaurantOrderPK(scope.orgId, scope.outletId, orderId),
          SK: K.restaurantSubmissionSK(submissionId),
        },
        "SUBMISSION",
      );
      if (!raw) throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      const row = TransactionSchemas.SUBMISSION.parse(raw);
      if (
        row.data.orderId !== orderId ||
        row.data.submissionId !== submissionId ||
        row.data.inventoryType
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      for (const target of row.data.inventoryTargets ?? []) {
        const cancelled = target.lines.filter((l) =>
          lines.some(
            (line) =>
              line.status === "ACCEPTED" &&
              line.itemId === l.itemId &&
              line.snapshot?.submissionId === submissionId,
          ),
        );
        if (!cancelled.length) continue;
        const next = targets.get(target.stockItemId) ?? {
          stockItemId: target.stockItemId,
          lines: [],
        };
        next.lines.push(...cancelled);
        targets.set(target.stockItemId, next);
        originals.add(submissionId);
        originalEvents[target.stockItemId] = [
          ...(originalEvents[target.stockItemId] ?? []),
          inventorySaleEventId(
            scope,
            orderId,
            submissionId,
            target.stockItemId,
          ),
        ];
      }
      if (originals.has(submissionId))
        dependencies.push(
          row.data.inventoryEffectRef ?? {
            id: submissionId,
            createdAt: row.data.committedAt,
          },
        );
    }
    return {
      targets: [...targets.values()],
      originals: [...originals],
      dependencies,
      originalEvents,
    };
  }

  static async resume(scope: TransactionScope, orderId: string) {
    scope = { orgId: scope.orgId, outletId: scope.outletId };
    try {
      const submissions = await R.submissions(scope, orderId);
      for (const row of submissions) {
        if (!row.data.inventoryEffectRef) continue;
        await InventoryEffects.process(scope, row.data.inventoryEffectRef);
      }
    } catch (error) {
      this.pending(scope, orderId, error);
    }
  }
  private static pending(
    scope: TransactionScope,
    orderId: string,
    error: unknown,
  ) {
    console.warn("[RESTAURANTS_INVENTORY_SYNC]", {
      ...scope,
      orderId,
      result: "PENDING",
      reason:
        error instanceof AppError
          ? error.messageCode
          : error instanceof Error
            ? error.name
            : "Unknown",
    });
  }
}
