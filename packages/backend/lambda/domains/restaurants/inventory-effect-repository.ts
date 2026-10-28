import {
  AttributeValue,
  QueryCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { InventoryRepository as R } from "./inventory-repository";
import { InventoryScope, InventoryScopeSchema } from "./inventory-model";
import {
  InventoryEffect,
  InventoryEffectReference,
  InventoryEffectReferenceSchema,
  InventoryEffectSchema,
  StoredInventoryEffect,
  StoredInventoryEffectSchema,
} from "./inventory-effect-model";
import { restaurantsTableName } from "./restaurant-storage";
import { transactionFingerprint } from "./transaction-repository";

const TYPE = "RESTAURANT_INVENTORY_EFFECT",
  PENDING = "RESTAURANT_INVENTORY_EFFECT_PENDING";
const locatorSchema = InventoryScopeSchema.extend(
  InventoryEffectReferenceSchema.shape,
).strict();
const retryable = (error: unknown) =>
  error instanceof Error &&
  ["TransactionCanceledException", "TransactionConflictException"].includes(
    error.name,
  );
const immutable = (effect: StoredInventoryEffect) =>
  transactionFingerprint({
    orgId: effect.orgId,
    outletId: effect.outletId,
    id: effect.id,
    createdAt: effect.createdAt,
    type: effect.type,
    source: effect.source,
    actorId: effect.actorId,
    dependencies: effect.dependencies,
    targets: effect.targets.map((target) => {
      if (!target || typeof target !== "object") return target;
      const {
        state: _,
        movementId: _m,
        lastErrorCode: _e,
        ...intent
      } = target as Record<string, unknown>;
      return intent;
    }),
  });
/** Inventory-owned primary-key authority plus an atomically maintained unresolved locator. No TTL dependency. */
export class InventoryEffectsRepository {
  static key(
    scope: InventoryScope,
    ref: InventoryEffectReference,
    pending = false,
  ) {
    InventoryScopeSchema.parse(scope);
    InventoryEffectReferenceSchema.parse({
      id: ref.id,
      createdAt: ref.createdAt,
    });
    return {
      PK: K.restaurantInventoryEffectPK(
        scope.orgId,
        scope.outletId,
        ref.createdAt.slice(0, 10).replace(/-/g, ""),
      ),
      SK: pending
        ? K.restaurantInventoryEffectPendingSK(ref.createdAt, ref.id)
        : K.restaurantInventoryEffectSK(ref.id),
    };
  }
  static stage(raw: InventoryEffect): TransactWriteItem[] {
    const effect = InventoryEffectSchema.parse(raw);
    if (
      effect.state !== "PENDING" ||
      effect.version !== 1 ||
      effect.attemptCount !== 0 ||
      effect.targets.some((t) => t.state !== "PENDING")
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    const scope = { orgId: effect.orgId, outletId: effect.outletId };
    const ref = { id: effect.id, createdAt: effect.createdAt };
    return [
      R.put(scope, this.key(scope, ref), TYPE, effect),
      R.put(scope, this.key(scope, ref, true), PENDING, { ...scope, ...ref }),
    ];
  }
  static async get(scope: InventoryScope, ref: InventoryEffectReference) {
    const effect = await R.get(
      scope,
      this.key(scope, ref),
      TYPE,
      StoredInventoryEffectSchema,
    );
    if (effect && (effect.id !== ref.id || effect.createdAt !== ref.createdAt))
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return effect;
  }
  static async update(
    scope: InventoryScope,
    ref: InventoryEffectReference,
    change: (old: StoredInventoryEffect) => StoredInventoryEffect,
  ) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const old = await this.get(scope, ref);
      if (!old) throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      if (old.state === "APPLIED") return old;
      const desired = change(old);
      if (immutable(desired) !== immutable(old))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      const next = StoredInventoryEffectSchema.parse({
        ...desired,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      });
      if (next.state === "APPLIED") InventoryEffectSchema.parse(next);
      const actions = [
        R.put(scope, this.key(scope, ref), TYPE, next, old.version),
      ];
      if (next.state === "APPLIED")
        actions.push({
          Delete: {
            TableName: restaurantsTableName(),
            Key: marshall(this.key(scope, ref, true)),
            ConditionExpression:
              "orgId = :org AND outletId = :out AND entityType = :type AND #d.#id = :id",
            ExpressionAttributeNames: { "#d": "data", "#id": "id" },
            ExpressionAttributeValues: marshall({
              ":org": scope.orgId,
              ":out": scope.outletId,
              ":type": PENDING,
              ":id": ref.id,
            }),
          },
        });
      try {
        await R.commit(actions);
        return next;
      } catch (error) {
        if (!retryable(error) || attempt === 7) throw error;
      }
    }
    throw new AppError(409, "RESTAURANTS_INVENTORY_CONFLICT");
  }
  /** One explicit outlet/day, bounded pages. FAILED remains discoverable for diagnosis/explicit retry. */
  static async unresolved(
    scope: InventoryScope,
    day: string,
    input: { limit?: number; cursor?: string } = {},
  ) {
    InventoryScopeSchema.parse(scope);
    const date = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(day);
    if (
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    const PK = K.restaurantInventoryEffectPK(
      scope.orgId,
      scope.outletId,
      date.replace(/-/g, ""),
    );
    const prefix = K.restaurantInventoryEffectPendingPrefix();
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(input.limit ?? 50);
    let start: Record<string, AttributeValue> | undefined;
    if (input.cursor) {
      try {
        const key = z
          .object({ PK: z.literal(PK), SK: z.string().startsWith(prefix) })
          .strict()
          .parse(
            JSON.parse(
              Buffer.from(
                z.string().max(2048).parse(input.cursor),
                "base64url",
              ).toString(),
            ),
          );
        start = marshall(key);
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const page = await dynamoClient.send(
      new QueryCommand({
        TableName: restaurantsTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({ ":pk": PK, ":prefix": prefix }),
        ConsistentRead: true,
        Limit: limit,
        ExclusiveStartKey: start,
      }),
    );
    const refs = (page.Items ?? []).map((raw) => {
      const row = unmarshall(raw);
      const ref = R.decode(
        scope,
        { PK, SK: row.SK },
        PENDING,
        locatorSchema,
        raw,
      );
      const reference = { id: ref.id, createdAt: ref.createdAt };
      if (
        this.key(scope, reference, true).PK !== PK ||
        this.key(scope, reference, true).SK !== row.SK
      )
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
      return reference;
    });
    const items: StoredInventoryEffect[] = [];
    for (let offset = 0; offset < refs.length; offset += 8) {
      for (const effect of await Promise.all(
        refs.slice(offset, offset + 8).map((ref) => this.get(scope, ref)),
      )) {
        if (!effect)
          throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
        if (effect.state !== "APPLIED") items.push(effect);
      }
    }
    const last = page.LastEvaluatedKey && unmarshall(page.LastEvaluatedKey);
    if (
      last &&
      (last.PK !== PK ||
        typeof last.SK !== "string" ||
        !last.SK.startsWith(prefix))
    )
      throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    return {
      items,
      nextCursor: last
        ? Buffer.from(JSON.stringify(last)).toString("base64url")
        : undefined,
    };
  }
}
