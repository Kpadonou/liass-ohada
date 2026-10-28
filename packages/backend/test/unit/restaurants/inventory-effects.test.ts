import { randomUUID } from "crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { InventoryEffects as P } from "@/lambda/domains/restaurants/inventory-effects";
import { InventoryEffectsRepository as R } from "@/lambda/domains/restaurants/inventory-effect-repository";
import { InventoryRepository as IR } from "@/lambda/domains/restaurants/inventory-repository";
import { RestaurantInventoryService as I } from "@/lambda/domains/restaurants/inventory-service";
import {
  InventoryEffectSchema,
  inventorySaleEventId,
} from "@/lambda/domains/restaurants/inventory-effect-model";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo } from "./memory-dynamo";
import { readFileSync } from "fs";
import { resolve } from "path";

let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>;
const scope = () => ({ orgId: "org-resto", outletId: f.outlet.id });
const now = () => new Date().toISOString();
beforeEach(async () => {
  m = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});
async function stock(unit = "BOTTLE") {
  return I.create(scope(), { id: randomUUID(), name: "Stock", unit });
}
function fact(stockItemId: string, type?: "SALE_REVERSAL") {
  return {
    orderId: randomUUID(),
    submissionId: randomUUID(),
    actorId: "owner",
    committedAt: now(),
    type,
    targets: [
      {
        stockItemId,
        lines: [
          { itemId: randomUUID(), menuItemId: randomUUID(), quantity: 2 },
        ],
      },
    ],
  };
}
async function stage(input: ReturnType<typeof fact>) {
  await IR.commit(P.stageSale(scope(), input));
  return { id: input.submissionId, createdAt: input.committedAt };
}
test("pending authority and discovery are durable before any execution; independent processor needs no Order or Menu", async () => {
  const s = await stock(),
    input = fact(s.id),
    ref = await stage(input);
  const before = await R.get(scope(), ref);
  expect(before).toMatchObject({
    state: "PENDING",
    attemptCount: 0,
    type: "SALE",
    source: { orderId: input.orderId, submissionId: input.submissionId },
    targets: [{ stockItemId: s.id, quantityMilli: "2000", state: "PENDING" }],
  });
  const discovered = await R.unresolved(
    scope(),
    input.committedAt.slice(0, 10),
  );
  expect(discovered.items).toHaveLength(1);
  expect((await I.get(scope(), s.id)).balanceMilli).toBe(0);
  const applied = await P.process(scope(), discovered.items[0]);
  expect(applied).toMatchObject({ state: "APPLIED", attemptCount: 1 });
  const target = InventoryEffectSchema.parse(applied).targets[0];
  expect(target.businessEventId).toBe(
    inventorySaleEventId(scope(), input.orderId, input.submissionId, s.id),
  );
  expect(target.movementId).toBe((await I.history(scope(), s.id)).items[0].id);
  expect(
    (await R.unresolved(scope(), input.committedAt.slice(0, 10))).items,
  ).toHaveLength(0);
  expect(await R.get(scope(), ref)).toEqual(applied);
});
test("crash after movement commit before APPLIED recovers the exact receipt even if target is subsequently missing", async () => {
  const s = await stock(),
    ref = await stage(fact(s.id));
  const update = R.update.bind(R);
  let fail = true;
  jest.spyOn(R, "update").mockImplementation(async (scope, ref, change) => {
    const old = (await R.get(scope, ref))!;
    if (fail && change(old).state === "APPLIED") {
      fail = false;
      throw new Error("Crash before finalization");
    }
    return update(scope, ref, change);
  });
  await P.process(scope(), ref);
  expect(await R.get(scope(), ref)).toMatchObject({
    state: "PENDING",
    attemptCount: 1,
  });
  const movement = (await I.history(scope(), s.id)).items[0];
  const key = JSON.stringify([
    K.restaurantStockPK(scope().orgId, scope().outletId),
    K.restaurantStockSK(s.id),
  ]);
  const durableStock = m.rows.get(key)!;
  m.rows.delete(key);
  const recovered = InventoryEffectSchema.parse(await P.process(scope(), ref));
  expect(recovered.state).toBe("APPLIED");
  expect(recovered.targets[0].movementId).toBe(movement.id);
  m.rows.set(key, durableStock);
  expect((await I.get(scope(), s.id)).balanceMilli).toBe(-2000);
  expect((await I.history(scope(), s.id)).items).toHaveLength(1);
});
test("crash after recording an attempt has no permanent claim and can be retried", async () => {
  const s = await stock(),
    ref = await stage(fact(s.id));
  const commit = IR.commit.bind(IR);
  let fail = true;
  jest.spyOn(IR, "commit").mockImplementation(async (actions) => {
    await commit(actions);
    if (
      fail &&
      actions.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_INVENTORY_EFFECT",
      )
    ) {
      fail = false;
      throw new Error("Lost attempt response");
    }
  });
  await P.process(scope(), ref);
  expect(await R.get(scope(), ref)).toMatchObject({
    state: "PENDING",
    attemptCount: 1,
  });
  expect((await I.history(scope(), s.id)).items).toHaveLength(0);
  expect((await P.process(scope(), ref))?.state).toBe("APPLIED");
  expect((await I.history(scope(), s.id)).items).toHaveLength(1);
});
test("technical failure persists safe retry metadata and remains queryable", async () => {
  const s = await stock(),
    input = fact(s.id),
    ref = await stage(input);
  const failure = jest
    .spyOn(I, "applyMovement")
    .mockRejectedValue(new Error("secret-token raw AWS payload"));
  const failed = await P.process(scope(), ref);
  expect(failed).toMatchObject({
    state: "RETRYABLE",
    attemptCount: 1,
    lastErrorCode: "TRANSIENT_FAILURE",
  });
  expect(JSON.stringify(failed)).not.toContain("secret-token");
  expect(
    (await R.unresolved(scope(), input.committedAt.slice(0, 10))).items[0]
      .state,
  ).toBe("RETRYABLE");
  failure.mockRestore();
  expect((await P.process(scope(), ref))?.state).toBe("APPLIED");
});
test("missing target is FAILED, stays discoverable, and requires explicit retry after repair", async () => {
  const id = randomUUID(),
    input = fact(id),
    ref = await stage(input);
  const failed = await P.process(scope(), ref);
  expect(failed).toMatchObject({
    state: "FAILED",
    lastErrorCode: "STOCK_ITEM_MISSING",
    attemptCount: 1,
  });
  expect(
    (await R.unresolved(scope(), input.committedAt.slice(0, 10))).items,
  ).toHaveLength(1);
  await I.create(scope(), { id, name: "Restored", unit: "BOTTLE" });
  expect((await P.process(scope(), ref))?.attemptCount).toBe(1);
  expect((await P.process(scope(), ref, { retryFailed: true }))?.state).toBe(
    "APPLIED",
  );
});
test("invalid discrete target and precision overflow are durable integrity failures", async () => {
  const s = await stock("KG"),
    invalid = await stage(fact(s.id));
  expect(await P.process(scope(), invalid)).toMatchObject({
    state: "FAILED",
    lastErrorCode: "INVALID_STOCK_UNIT",
  });
  const discrete = await stock();
  const input = fact(discrete.id);
  input.targets[0].lines[0].quantity = Number.MAX_SAFE_INTEGER;
  const overflow = await stage(input);
  expect(await P.process(scope(), overflow)).toMatchObject({
    state: "FAILED",
    lastErrorCode: "INVALID_QUANTITY",
  });
  expect((await I.get(scope(), discrete.id)).balanceMilli).toBe(0);
});
test("corrupt payload is retained for audit and quarantined without a movement", async () => {
  const s = await stock(),
    ref = await stage(fact(s.id));
  const key = R.key(scope(), ref),
    identity = JSON.stringify([key.PK, key.SK]);
  const raw = unmarshall(m.rows.get(identity)!);
  raw.data.targets[0].quantityMilli = "corrupt";
  m.rows.set(identity, marshall(raw));
  const failed = await P.process(scope(), ref);
  expect(failed).toMatchObject({
    state: "FAILED",
    lastErrorCode: "INVALID_EFFECT",
    targets: [{ quantityMilli: "corrupt" }],
  });
  expect((await P.process(scope(), ref))?.attemptCount).toBe(1);
  expect((await I.history(scope(), s.id)).items).toHaveLength(0);
});
test("SALE_REVERSAL independently reconciles original SALE via stable causal references", async () => {
  const s = await stock(),
    original = fact(s.id),
    originalRef = await stage(original);
  const reversal = {
    ...fact(s.id, "SALE_REVERSAL"),
    orderId: original.orderId,
    dependencies: [originalRef],
    originalEvents: {
      [s.id]: [
        inventorySaleEventId(
          scope(),
          original.orderId,
          original.submissionId,
          s.id,
        ),
      ],
    },
  };
  await IR.commit(P.stageSale(scope(), reversal));
  const ref = { id: reversal.submissionId, createdAt: reversal.committedAt };
  expect((await P.process(scope(), ref))?.state).toBe("APPLIED");
  expect((await R.get(scope(), originalRef))?.state).toBe("APPLIED");
  await Promise.all([P.process(scope(), ref), P.process(scope(), ref)]);
  expect((await I.get(scope(), s.id)).balanceMilli).toBe(0);
  expect((await I.history(scope(), s.id)).items.map((m) => m.type)).toEqual([
    "SALE_REVERSAL",
    "SALE",
  ]);
});
test("reversal remains retryable when original SALE cannot yet converge", async () => {
  const s = await stock(),
    original = fact(s.id),
    originalRef = await stage(original);
  const reversal = {
    ...fact(s.id, "SALE_REVERSAL"),
    orderId: original.orderId,
    dependencies: [originalRef],
    originalEvents: {
      [s.id]: [
        inventorySaleEventId(
          scope(),
          original.orderId,
          original.submissionId,
          s.id,
        ),
      ],
    },
  };
  await IR.commit(P.stageSale(scope(), reversal));
  const ref = { id: reversal.submissionId, createdAt: reversal.committedAt };
  const fail = jest
    .spyOn(I, "applyMovement")
    .mockRejectedValue(new Error("Unavailable"));
  expect(await P.process(scope(), ref)).toMatchObject({
    state: "RETRYABLE",
    lastErrorCode: "DEPENDENCY_PENDING",
  });
  expect((await I.history(scope(), s.id)).items).toHaveLength(0);
  fail.mockRestore();
  expect((await P.process(scope(), ref))?.state).toBe("APPLIED");
  expect((await I.get(scope(), s.id)).balanceMilli).toBe(0);
});
test("outlet/day unresolved discovery is bounded, paginated and tenant/cursor isolated", async () => {
  const s = await stock();
  const refs = await Promise.all([
    stage(fact(s.id)),
    stage(fact(s.id)),
    stage(fact(s.id)),
  ]);
  const day = refs[0].createdAt.slice(0, 10);
  const page = await R.unresolved(scope(), day, { limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).toBeDefined();
  const next = await R.unresolved(scope(), day, {
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.items[0].id).not.toBe(page.items[0].id);
  expect(
    (await R.unresolved({ ...scope(), orgId: "other-org" }, day)).items,
  ).toHaveLength(0);
  expect(
    (await R.unresolved({ ...scope(), outletId: randomUUID() }, day)).items,
  ).toHaveLength(0);
  await expect(
    R.unresolved({ ...scope(), orgId: "other-org" }, day, {
      cursor: page.nextCursor,
    }),
  ).rejects.toMatchObject({ statusCode: 400 });
  await expect(R.unresolved(scope(), day, { limit: 101 })).rejects.toThrow();
  for (const call of m.db.commandCalls(QueryCommand))
    expect(call.args[0].input).toMatchObject({ ConsistentRead: true });
});
test("immutable effect identity cannot be changed by processing metadata updates", async () => {
  const s = await stock(),
    ref = await stage(fact(s.id));
  await expect(
    R.update(scope(), ref, (old) => ({
      ...old,
      source: { ...old.source, reference: "changed" },
    })),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect((await R.get(scope(), ref))?.version).toBe(1);
});
test("source extension needs no SALE storage branch, Menu snapshot or commercial record mutation", async () => {
  const s = await stock(),
    input = fact(s.id),
    actions = P.stageSale(scope(), input);
  const effect = unmarshall(actions[0].Put!.Item!).data;
  effect.source = { kind: "OTHER_SALE_PRODUCER", reference: randomUUID() };
  effect.targets[0].businessEventId = "OTHER_SOURCE:" + randomUUID();
  await IR.commit(R.stage(effect));
  expect(
    (await P.process(scope(), { id: effect.id, createdAt: effect.createdAt }))
      ?.state,
  ).toBe("APPLIED");
  const processor = readFileSync(
    resolve(
      __dirname,
      "../../../lambda/domains/restaurants/inventory-effects.ts",
    ),
    "utf8",
  );
  expect(processor).not.toMatch(
    /InventoryTrackingService|RestaurantsService|\.order\(|\.submissions\(/,
  );
  for (const file of [
    "inventory-effect-repository.ts",
    "inventory-effects.ts",
    "inventory-effect-model.ts",
  ]) {
    expect(
      readFileSync(
        resolve(__dirname, "../../../lambda/domains/restaurants", file),
        "utf8",
      ),
    ).not.toMatch(/ScanCommand|IndexName|GSI\d|aws-cdk/);
  }
  expect(
    readFileSync(
      resolve(
        __dirname,
        "../../../lambda/domains/restaurants/transaction-service.ts",
      ),
      "utf8",
    ),
  ).not.toMatch(/StockItemSchema|balanceMilli|\.applyMovement\(/);
});
