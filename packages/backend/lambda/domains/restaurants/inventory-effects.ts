import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantInventoryService as Inventory } from "./inventory-service";
import { InventoryScope } from "./inventory-model";
import { InventorySaleTargetSchema } from "./transaction-model";
import { InventoryEffectsRepository as R } from "./inventory-effect-repository";
import {
  InventoryEffect,
  InventoryEffectError,
  InventoryEffectReference,
  InventoryEffectSchema,
  StoredInventoryEffect,
  inventorySaleEventId,
} from "./inventory-effect-model";

type Target = z.infer<typeof InventorySaleTargetSchema>;
type SaleFact = {
  orderId: string;
  submissionId: string;
  actorId: string;
  committedAt: string;
  targets: Target[];
  type?: "SALE_REVERSAL";
  dependencies?: InventoryEffectReference[];
  originalEvents?: Record<string, string[]>;
};
function classification(error: unknown): {
  state: "FAILED" | "RETRYABLE";
  code: InventoryEffectError;
} {
  if (error instanceof z.ZodError)
    return { state: "FAILED", code: "INVALID_EFFECT" };
  if (error instanceof AppError) {
    if (error.messageCode === "RESTAURANTS_INVENTORY_NOT_FOUND")
      return { state: "FAILED", code: "STOCK_ITEM_MISSING" };
    if (error.messageCode === "RESTAURANTS_INVENTORY_TRACKING_TARGET")
      return { state: "FAILED", code: "INVALID_STOCK_UNIT" };
    if (error.messageCode === "RESTAURANTS_TRANSACTION_INTEGRITY")
      return { state: "FAILED", code: "INVALID_EFFECT" };
    if (error.messageCode === "RESTAURANTS_INVENTORY_CONFLICT")
      return { state: "FAILED", code: "INVENTORY_CONFLICT" };
    if (error.messageCode === "RESTAURANTS_INVENTORY_QUANTITY")
      return { state: "FAILED", code: "INVALID_QUANTITY" };
    return error.statusCode >= 500
      ? { state: "RETRYABLE", code: "TRANSIENT_FAILURE" }
      : { state: "FAILED", code: "INVALID_EFFECT" };
  }
  return { state: "RETRYABLE", code: "TRANSIENT_FAILURE" };
}
/** Independent Inventory processor: accepts only a stable effect reference, never Menu/Order reconstruction. */
export class InventoryEffects {
  static stageSale(scope: InventoryScope, fact: SaleFact) {
    if (!fact.targets.length) return [];
    const type = fact.type ?? "SALE";
    return R.stage(
      InventoryEffectSchema.parse({
        orgId: scope.orgId,
        outletId: scope.outletId,
        id: fact.submissionId,
        version: 1,
        createdAt: fact.committedAt,
        updatedAt: fact.committedAt,
        type,
        source: {
          kind: "RESTAURANT_ORDER",
          reference: fact.orderId,
          orderId: fact.orderId,
          submissionId: fact.submissionId,
        },
        actorId: fact.actorId,
        dependencies: fact.dependencies ?? [],
        state: "PENDING",
        attemptCount: 0,
        targets: fact.targets.map((target) => ({
          stockItemId: target.stockItemId,
          quantityMilli: target.lines
            .reduce((total, line) => total + BigInt(line.quantity) * 1000n, 0n)
            .toString(),
          businessEventId: inventorySaleEventId(
            scope,
            fact.orderId,
            fact.submissionId,
            target.stockItemId,
            type,
          ),
          ...(fact.originalEvents?.[target.stockItemId]
            ? {
                originalBusinessEventIds:
                  fact.originalEvents[target.stockItemId],
              }
            : {}),
          state: "PENDING",
        })),
      }),
    );
  }

  static async process(
    scope: InventoryScope,
    ref: InventoryEffectReference,
    options: { retryFailed?: boolean } = {},
    depth = 0,
  ): Promise<StoredInventoryEffect | undefined> {
    scope = { orgId: scope.orgId, outletId: scope.outletId };
    try {
      const stored = await R.get(scope, ref);
      if (!stored || stored.state === "APPLIED") return stored;
      if (
        stored.state === "FAILED" &&
        stored.lastErrorCode === "INVALID_EFFECT" &&
        !options.retryFailed
      )
        return stored;
      const parsed = InventoryEffectSchema.safeParse(stored);
      if (!parsed.success || !this.validIntent(scope, parsed.data)) {
        return await R.update(scope, ref, (old) => ({
          ...old,
          state: "FAILED",
          lastErrorCode: "INVALID_EFFECT",
          attemptCount: old.attemptCount + 1,
          lastAttemptAt: new Date().toISOString(),
        }));
      }
      const effect = parsed.data;
      if (
        !options.retryFailed &&
        effect.targets.every(
          (t) => t.state === "FAILED" || t.state === "APPLIED",
        )
      )
        return stored;
      await R.update(scope, ref, (old) => ({
        ...old,
        attemptCount: old.attemptCount + 1,
        lastAttemptAt: new Date().toISOString(),
      }));
      let dependencyError:
        | { state: "FAILED" | "RETRYABLE"; code: InventoryEffectError }
        | undefined;
      const originals: InventoryEffect[] = [];
      for (const dependency of effect.dependencies) {
        const original = await R.get(scope, dependency);
        if (
          !original ||
          original.type !== "SALE" ||
          original.source.orderId !== effect.source.orderId ||
          depth > 0
        ) {
          dependencyError = { state: "FAILED", code: "INVALID_EFFECT" };
          break;
        }
        if (original.state !== "APPLIED")
          await this.process(scope, dependency, options, depth + 1);
        const canonical = await R.get(scope, dependency);
        if (!canonical || canonical.state !== "APPLIED") {
          dependencyError =
            canonical?.state === "FAILED"
              ? { state: "FAILED", code: "DEPENDENCY_FAILED" }
              : { state: "RETRYABLE", code: "DEPENDENCY_PENDING" };
          break;
        }
        originals.push(InventoryEffectSchema.parse(canonical));
      }
      for (const target of effect.targets) {
        if (
          target.state === "APPLIED" ||
          (target.state === "FAILED" && !options.retryFailed)
        )
          continue;
        let outcome: {
          state: "APPLIED" | "FAILED" | "RETRYABLE";
          code?: InventoryEffectError;
          movementId?: string;
        };
        if (dependencyError) outcome = dependencyError;
        else if (
          effect.type === "SALE_REVERSAL" &&
          !this.validReversal(target, originals)
        )
          outcome = { state: "FAILED", code: "INVALID_EFFECT" };
        else if (BigInt(target.quantityMilli) > BigInt(Number.MAX_SAFE_INTEGER))
          outcome = { state: "FAILED", code: "INVALID_QUANTITY" };
        else {
          try {
            const movement = await Inventory.applyMovement(
              scope,
              {
                stockItemId: target.stockItemId,
                type: effect.type,
                quantityMilli: Number(target.quantityMilli),
                source: "BUSINESS_EVENT",
                actorId: effect.actorId,
                sourceReference: effect.source.reference,
                businessEventId: target.businessEventId,
              },
              {
                requireDiscreteUnit: effect.source.kind === "RESTAURANT_ORDER",
              },
            );
            outcome = { state: "APPLIED", movementId: movement.id };
          } catch (error) {
            outcome = classification(error);
          }
        }
        await R.update(scope, ref, (old) => {
          const current = InventoryEffectSchema.parse(old);
          const targets = current.targets.map((t) =>
            t.businessEventId !== target.businessEventId ||
            t.state === "APPLIED"
              ? t
              : {
                  ...t,
                  state: outcome.state,
                  lastErrorCode: outcome.code,
                  movementId: outcome.movementId,
                },
          );
          const state = targets.every((t) => t.state === "APPLIED")
            ? "APPLIED"
            : targets.some((t) => t.state === "FAILED")
              ? "FAILED"
              : targets.some((t) => t.state === "RETRYABLE")
                ? "RETRYABLE"
                : "PENDING";
          return {
            ...current,
            targets,
            state,
            lastErrorCode: targets.find((t) => t.lastErrorCode)?.lastErrorCode,
            ...(state === "APPLIED"
              ? { appliedAt: new Date().toISOString() }
              : {}),
          };
        });
      }
      return await R.get(scope, ref);
    } catch (error) {
      // A failure to persist an outcome leaves the prior durable state/locator and deterministic receipts intact.
      console.warn("[RESTAURANTS_INVENTORY_SYNC]", {
        ...scope,
        effectId: ref.id,
        result: "PENDING",
        reason: classification(error).code,
      });
      return undefined;
    }
  }

  private static validIntent(scope: InventoryScope, effect: InventoryEffect) {
    if (
      new Set(effect.targets.map((t) => t.stockItemId)).size !==
        effect.targets.length ||
      new Set(effect.targets.map((t) => t.businessEventId)).size !==
        effect.targets.length
    )
      return false;
    if (effect.type === "SALE" && effect.dependencies.length) return false;
    if (effect.type === "SALE_REVERSAL" && !effect.dependencies.length)
      return false;
    if (effect.source.kind !== "RESTAURANT_ORDER") return true;
    const { orderId, submissionId } = effect.source;
    return (
      !!orderId &&
      submissionId === effect.id &&
      effect.source.reference === orderId &&
      effect.targets.every(
        (t) =>
          t.businessEventId ===
          inventorySaleEventId(
            scope,
            orderId,
            effect.id,
            t.stockItemId,
            effect.type,
          ),
      )
    );
  }
  private static validReversal(
    target: InventoryEffect["targets"][number],
    originals: InventoryEffect[],
  ) {
    const sources = originals.flatMap((o) =>
      o.targets.filter((t) => t.stockItemId === target.stockItemId),
    );
    const ids = target.originalBusinessEventIds;
    return (
      !!ids?.length &&
      ids.every((id) => sources.some((s) => s.businessEventId === id)) &&
      BigInt(target.quantityMilli) <=
        sources
          .filter((s) => ids.includes(s.businessEventId))
          .reduce((n, s) => n + BigInt(s.quantityMilli), 0n)
    );
  }
}
