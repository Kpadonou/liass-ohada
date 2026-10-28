import { randomUUID } from "crypto";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { InventorySales } from "@/lambda/domains/restaurants/inventory-sales";
import { RestaurantInventoryService as I } from "@/lambda/domains/restaurants/inventory-service";
import { InventoryTrackingService as T } from "@/lambda/domains/restaurants/inventory-tracking-service";
import { InventoryRepository as IR } from "@/lambda/domains/restaurants/inventory-repository";
import { RestaurantTransactionsService as E } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import * as c from "@liass-ohada/shared/restaurants";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>;
const scope = () => ({ orgId: "org-resto", outletId: f.outlet.id });
const ctx = () => ({ ...scope(), actorId: "owner" });
const rows = () => [...m.rows.values()].map((r) => unmarshall(r));
const sales = () =>
  rows().filter(
    (r) =>
      r.entityType === "RESTAURANT_STOCK_MOVEMENT" && r.data.type === "SALE",
  );
const menu = () => f.items[4];
beforeEach(async () => {
  m = memoryDynamo();
  m.seedAccess("org-resto", "owner", "OWNER");
  f = await acceptanceFixture();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});
async function link(item = menu(), stockItemId?: string) {
  const r = await T.save(scope(), item.id, "owner", {
    categoryId: item.categoryId,
    expectedVersion: 0,
    clientRequestId: randomUUID(),
    ...(stockItemId
      ? { mode: "LINK", stockItemId }
      : { mode: "CREATE", unit: "BOTTLE" }),
  });
  return r.stockItem!;
}
async function draft(
  lines = [{ item: menu(), quantity: 1 }],
  orderId?: string,
) {
  if (!orderId) {
    const s = c.GuestSessionSchema.parse(
      (
        await E.mutate(ctx(), "OPEN_SESSION", {
          clientRequestId: randomUUID(),
          areaId: f.areas[0].id,
          tableId: f.tables[0].id,
        })
      ).data,
    );
    orderId = c.RestaurantOrderSchema.parse(
      (
        await E.mutate(ctx(), "CREATE_ORDER", {
          clientRequestId: randomUUID(),
          orderType: "DINE_IN",
          guestSessionId: s.guestSessionId,
        })
      ).data,
    ).orderId;
  }
  const selected = [];
  for (const { item, quantity } of lines) {
    const order = await E.order(scope(), orderId);
    const line = c.RestaurantOrderItemSchema.parse(
      (
        await E.mutate(
          ctx(),
          "ADD_ITEM",
          {
            clientRequestId: randomUUID(),
            expectedVersion: order.data.version,
            menuItemId: item.id,
            categoryId: item.categoryId,
            quantity,
            expectedMenuItemVersion: item.version,
          },
          { orderId },
        )
      ).data,
    );
    selected.push({ itemId: line.itemId, expectedVersion: line.version });
  }
  const req = {
    clientRequestId: randomUUID(),
    expectedVersion: (await E.order(scope(), orderId)).data.version,
    items: selected,
  };
  return {
    orderId,
    req,
    run: () => E.mutate(ctx(), "SUBMIT_ORDER", req, { orderId }),
  };
}
test.each([
  [10000, 2, 8000],
  [1000, 1, 0],
  [0, 1, -1000],
  [-3000, 2, -5000],
])("canonical sale %i - %i units = %i", async (initial, quantity, expected) => {
  const stock = await link();
  if (initial)
    await I.applyMovement(scope(), {
      stockItemId: stock.id,
      type: "ADJUSTMENT",
      quantityMilli: initial,
      source: "MANUAL",
      actorId: "owner",
    });
  const d = await draft([{ item: menu(), quantity }]);
  await d.run();
  await d.run();
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(expected);
  expect(sales()).toHaveLength(1);
  expect(sales()[0].data).toMatchObject({
    type: "SALE",
    deltaMilli: -quantity * 1000,
    resultingBalanceMilli: expected,
    source: "BUSINESS_EVENT",
    sourceReference: d.orderId,
    actorId: "owner",
  });
  const submission = rows().find(
    (r) => r.entityType === "RESTAURANT_SUBMISSION",
  )!;
  expect(sales()[0].data.businessEventId).toBe(
    InventorySales.eventId(
      scope(),
      d.orderId,
      submission.data.submissionId,
      stock.id,
    ),
  );
  expect(submission.data.inventoryCompletedAt).toBeDefined();
});
test("inactive target accepts automatic SALE while manual loss remains forbidden", async () => {
  const s = await link();
  await I.update(scope(), s.id, {
    expectedVersion: s.version,
    isActive: false,
  });
  await expect(
    I.applyMovement(scope(), {
      stockItemId: s.id,
      type: "LOSS",
      source: "MANUAL",
      actorId: "owner",
      quantityMilli: 1000,
    }),
  ).rejects.toMatchObject({ statusCode: 422 });
  await (await draft()).run();
  expect(await I.get(scope(), s.id)).toMatchObject({
    balanceMilli: -1000,
    isActive: false,
  });
});
test("many-to-one aggregates a batch; tracked/untracked lines stay independent; later batches are distinct sales", async () => {
  const stock = await link();
  const other = await Config.create(
    scope().orgId,
    "owner",
    "item",
    { outletId: scope().outletId, categoryId: menu().categoryId },
    {
      clientRequestId: randomUUID(),
      name: "Other drink",
      price: { amountMinor: 1, currency: "XOF" },
    },
  );
  await link(other, stock.id);
  const d = await draft([
    { item: menu(), quantity: 2 },
    { item: other, quantity: 3 },
    { item: f.items[0], quantity: 1 },
  ]);
  await d.run();
  expect(sales()).toHaveLength(1);
  expect(sales()[0].data.deltaMilli).toBe(-5000);
  const submission = rows().find(
    (r) => r.entityType === "RESTAURANT_SUBMISSION",
  )!;
  expect(submission.data.inventoryTargets[0].lines).toHaveLength(2);
  await (await draft([{ item: menu(), quantity: 1 }], d.orderId)).run();
  expect(sales()).toHaveLength(2);
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(-6000);
});
test("missing or removed tracking produces no movement", async () => {
  const d = await draft();
  await d.run();
  expect(sales()).toHaveLength(0);
  await link();
  await T.save(
    scope(),
    menu().id,
    "owner",
    {
      categoryId: menu().categoryId,
      expectedVersion: 1,
      clientRequestId: randomUUID(),
    },
    true,
  );
  await (await draft(undefined, d.orderId)).run();
  expect(sales()).toHaveLength(0);
});
test("committed sale survives Inventory failure; retry uses captured target after relink and never recreates Order", async () => {
  const a = await link();
  const d = await draft();
  const failure = jest
    .spyOn(I, "applyMovement")
    .mockRejectedValue(new Error("Unavailable"));
  await d.run();
  expect(sales()).toHaveLength(0);
  const submission = rows().find(
    (r) => r.entityType === "RESTAURANT_SUBMISSION",
  )!;
  expect(submission.data.inventoryCompletedAt).toBeUndefined();
  const b = await I.create(scope(), {
    id: randomUUID(),
    name: "New target",
    unit: "CAN",
  });
  await T.save(scope(), menu().id, "owner", {
    mode: "LINK",
    stockItemId: b.id,
    categoryId: menu().categoryId,
    expectedVersion: 1,
    clientRequestId: randomUUID(),
  });
  failure.mockRestore();
  await d.run();
  expect((await I.get(scope(), a.id)).balanceMilli).toBe(-1000);
  expect((await I.get(scope(), b.id)).balanceMilli).toBe(0);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_ORDER"),
  ).toHaveLength(1);
});
test("missing StockItem retains pending effect and accepted commercial Order", async () => {
  const s = await link();
  const d = await draft();
  const key = JSON.stringify([
    K.restaurantStockPK(scope().orgId, scope().outletId),
    K.restaurantStockSK(s.id),
  ]);
  const raw = m.rows.get(key)!;
  m.rows.delete(key);
  expect((await d.run()).data.status).toBe("SUBMITTED");
  expect(sales()).toHaveLength(0);
  expect(
    rows().find((r) => r.entityType === "RESTAURANT_SUBMISSION")!.data
      .inventoryCompletedAt,
  ).toBeUndefined();
  m.rows.set(key, raw);
  await E.order(scope(), d.orderId);
  expect(sales()).toHaveLength(1);
});
test("concurrent duplicate continuation and different Orders preserve every effect exactly once", async () => {
  const stock = await link();
  await I.applyMovement(scope(), {
    stockItemId: stock.id,
    type: "RECEIPT",
    quantityMilli: 10000,
    source: "MANUAL",
    actorId: "owner",
  });
  const failure = jest
    .spyOn(I, "applyMovement")
    .mockRejectedValue(new Error("Unavailable"));
  const a = await draft([{ item: menu(), quantity: 3 }]);
  await a.run();
  const s = c.GuestSessionSchema.parse(
    (
      await E.mutate(ctx(), "OPEN_SESSION", {
        clientRequestId: randomUUID(),
        areaId: f.areas[1].id,
        tableId: f.tables[1].id,
      })
    ).data,
  );
  const bOrder = c.RestaurantOrderSchema.parse(
    (
      await E.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: randomUUID(),
        orderType: "DINE_IN",
        guestSessionId: s.guestSessionId,
      })
    ).data,
  );
  const b = await draft([{ item: menu(), quantity: 4 }], bOrder.orderId);
  await b.run();
  failure.mockRestore();
  await Promise.all([
    InventorySales.resume(scope(), a.orderId),
    InventorySales.resume(scope(), a.orderId),
    InventorySales.resume(scope(), b.orderId),
  ]);
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(3000);
  expect(sales()).toHaveLength(2);
});
test("transaction failure creates no sale snapshot or movement; mapping guard prevents stale capture", async () => {
  const stock = await link();
  const d = await draft();
  const original = R.commit.bind(R);
  let once = true;
  jest.spyOn(R, "commit").mockImplementation(async (actions, max) => {
    if (
      once &&
      actions.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_SUBMISSION",
      )
    ) {
      once = false;
      await T.save(
        scope(),
        menu().id,
        "owner",
        {
          categoryId: menu().categoryId,
          expectedVersion: 1,
          clientRequestId: randomUUID(),
        },
        true,
      );
    }
    return original(actions, max);
  });
  await expect(d.run()).rejects.toMatchObject({ statusCode: 409 });
  expect(sales()).toHaveLength(0);
  expect(
    rows().filter((r) => r.entityType === "RESTAURANT_SUBMISSION"),
  ).toHaveLength(0);
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(0);
  await d.run();
  expect(sales()).toHaveLength(0);
});
test("lost acknowledgement after movement commit resumes from durable receipt without second decrement", async () => {
  const stock = await link();
  const d = await draft();
  const original = IR.commit.bind(IR);
  jest.spyOn(IR, "commit").mockImplementationOnce(async (actions) => {
    await original(actions);
    throw new Error("Lost response");
  });
  await d.run();
  expect(sales()).toHaveLength(1);
  await E.order(scope(), d.orderId);
  expect(sales()).toHaveLength(1);
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(-1000);
});
test("canonical accepted-line cancellation reverses original captured sale once even after unlink", async () => {
  const stock = await link();
  const d = await draft([{ item: menu(), quantity: 3 }]);
  await d.run();
  await T.save(
    scope(),
    menu().id,
    "owner",
    {
      categoryId: menu().categoryId,
      expectedVersion: 1,
      clientRequestId: randomUUID(),
    },
    true,
  );
  const order = await E.order(scope(), d.orderId),
    line = await E.line(scope(), d.orderId, d.req.items[0].itemId);
  const req = {
    clientRequestId: randomUUID(),
    expectedVersion: order.data.version,
    expectedItemVersion: line.data.version,
    reason: "Customer cancelled",
  };
  await E.mutate(ctx(), "CANCEL_ITEM", req, {
    orderId: d.orderId,
    itemId: line.data.itemId,
  });
  await E.mutate(ctx(), "CANCEL_ITEM", req, {
    orderId: d.orderId,
    itemId: line.data.itemId,
  });
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(0);
  const movements = (await I.history(scope(), stock.id)).items;
  expect(movements).toHaveLength(2);
  expect(movements[0]).toMatchObject({
    type: "SALE_REVERSAL",
    deltaMilli: 3000,
    resultingBalanceMilli: 0,
    sourceReference: d.orderId,
  });
});
test("zero-value canonical Order cancellation reverses still accepted tracked quantities once", async () => {
  const free = await Config.create(
    scope().orgId,
    "owner",
    "item",
    { outletId: scope().outletId, categoryId: menu().categoryId },
    {
      clientRequestId: randomUUID(),
      name: "Complimentary bottle",
      price: { amountMinor: 0, currency: "XOF" },
    },
  );
  const stock = await link(free);
  const d = await draft([{ item: free, quantity: 2 }]);
  await d.run();
  const order = await E.order(scope(), d.orderId);
  const req = {
    clientRequestId: randomUUID(),
    expectedVersion: order.data.version,
    reason: "Cancelled",
  };
  await E.mutate(ctx(), "CANCEL_ORDER", req, { orderId: d.orderId });
  await E.mutate(ctx(), "CANCEL_ORDER", req, { orderId: d.orderId });
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(0);
  expect((await I.history(scope(), stock.id)).items.map((m) => m.type)).toEqual(
    ["SALE_REVERSAL", "SALE"],
  );
});
test("pending original SALE is recovered before its reversal after Inventory outage", async () => {
  const stock = await link();
  const d = await draft();
  const failure = jest
    .spyOn(I, "applyMovement")
    .mockRejectedValue(new Error("Unavailable"));
  await d.run();
  const order = await E.order(scope(), d.orderId),
    line = await E.line(scope(), d.orderId, d.req.items[0].itemId);
  await E.mutate(
    ctx(),
    "CANCEL_ITEM",
    {
      clientRequestId: randomUUID(),
      expectedVersion: order.data.version,
      expectedItemVersion: line.data.version,
      reason: "Cancelled",
    },
    { orderId: d.orderId, itemId: line.data.itemId },
  );
  failure.mockRestore();
  await E.order(scope(), d.orderId);
  expect((await I.get(scope(), stock.id)).balanceMilli).toBe(0);
  expect((await I.history(scope(), stock.id)).items.map((m) => m.type)).toEqual(
    ["SALE_REVERSAL", "SALE"],
  );
});
test("closing a zero-value accepted Order is not a commercial reversal", async () => {
  const free = await Config.create(
    scope().orgId,
    "owner",
    "item",
    { outletId: scope().outletId, categoryId: menu().categoryId },
    {
      clientRequestId: randomUUID(),
      name: "Free bottle",
      price: { amountMinor: 0, currency: "XOF" },
    },
  );
  const stock = await link(free);
  const d = await draft([{ item: free, quantity: 1 }]);
  await d.run();
  await E.mutate(
    ctx(),
    "CLOSE_ORDER",
    {
      clientRequestId: randomUUID(),
      expectedVersion: (await E.order(scope(), d.orderId)).data.version,
    },
    { orderId: d.orderId },
  );
  expect((await I.history(scope(), stock.id)).items.map((m) => m.type)).toEqual(
    ["SALE"],
  );
});
test("multiple target partial progress retries each receipt without double impact", async () => {
  const a = await link();
  const other = await Config.create(
    scope().orgId,
    "owner",
    "item",
    { outletId: scope().outletId, categoryId: menu().categoryId },
    {
      clientRequestId: randomUUID(),
      name: "Other",
      price: { amountMinor: 1, currency: "XOF" },
    },
  );
  const b = await link(other);
  const d = await draft([
    { item: menu(), quantity: 2 },
    { item: other, quantity: 3 },
  ]);
  const original = I.applyMovement.bind(I);
  let fail = true;
  jest.spyOn(I, "applyMovement").mockImplementation(async (scope, input) => {
    if ((input as { stockItemId: string }).stockItemId === b.id && fail)
      throw new Error("Unavailable");
    return original(scope, input);
  });
  await d.run();
  expect(sales()).toHaveLength(1);
  fail = false;
  await E.order(scope(), d.orderId);
  expect(sales()).toHaveLength(2);
  expect((await I.get(scope(), a.id)).balanceMilli).toBe(-2000);
  expect((await I.get(scope(), b.id)).balanceMilli).toBe(-3000);
});
test("twelve distinct tracked categories retain transaction headroom and apply twelve independent effects", async () => {
  const lines = [];
  for (let n = 0; n < 12; n++) {
    const category = await Config.create(
      scope().orgId,
      "owner",
      "category",
      { outletId: scope().outletId },
      { clientRequestId: randomUUID(), name: `Stock category ${n}` },
    );
    const item = await Config.create(
      scope().orgId,
      "owner",
      "item",
      { outletId: scope().outletId, categoryId: category.id },
      {
        clientRequestId: randomUUID(),
        name: `Stock product ${n}`,
        price: { amountMinor: 1, currency: "XOF" },
      },
    );
    await link(item);
    lines.push({ item, quantity: 1 });
  }
  await (await draft(lines)).run();
  const commercial = m.transactions.find((t) =>
    t.TransactItems?.some(
      (a) =>
        a.Put?.Item?.entityType?.S === "RESTAURANT_ORDER" &&
        unmarshall(a.Put.Item).data.status === "SUBMITTED",
    ),
  )!;
  expect(commercial.TransactItems).toHaveLength(59);
  expect(sales()).toHaveLength(12);
  expect(m.transactions.every((t) => t.TransactItems!.length <= 95)).toBe(true);
  expect(
    (await I.list(scope())).items.every((i) => i.balanceMilli === -1000),
  ).toBe(true);
});
test("absent mapping guard prevents a concurrent new link being omitted at acceptance", async () => {
  const d = await draft();
  const original = R.commit.bind(R);
  let once = true;
  jest.spyOn(R, "commit").mockImplementation(async (actions, max) => {
    if (
      once &&
      actions.some(
        (a) => a.Put?.Item?.entityType?.S === "RESTAURANT_SUBMISSION",
      )
    ) {
      once = false;
      await link();
    }
    return original(actions, max);
  });
  await expect(d.run()).rejects.toMatchObject({ statusCode: 409 });
  expect(sales()).toHaveLength(0);
  await d.run();
  expect(sales()).toHaveLength(1);
});
test("durable submission reads use bounded strongly consistent paginated Query", async () => {
  const orderId = randomUUID();
  const actions = [];
  for (let n = 0; n < 101; n++) {
    const submissionId = randomUUID();
    actions.push(
      R.put(
        R.row(
          scope(),
          {
            PK: K.restaurantOrderPK(scope().orgId, scope().outletId, orderId),
            SK: K.restaurantSubmissionSK(submissionId),
          },
          "SUBMISSION",
          {
            orderId,
            submissionId,
            count: 1,
            actorId: "owner",
            fingerprint: "a".repeat(64),
            committedAt: new Date().toISOString(),
            inventoryTargets: [],
          },
        ),
      ),
    );
  }
  await R.commit(actions.slice(0, 90));
  await R.commit(actions.slice(90));
  const { QueryCommand } = await import("@aws-sdk/client-dynamodb");
  expect(await R.submissions(scope(), orderId)).toHaveLength(101);
  const queries = m.db
    .commandCalls(QueryCommand)
    .filter(
      (c) =>
        c.args[0].input.ExpressionAttributeValues?.[":prefix"]?.S ===
        K.restaurantSubmissionPrefix(),
    );
  expect(queries).toHaveLength(2);
  for (const q of queries)
    expect(q.args[0].input).toMatchObject({ ConsistentRead: true, Limit: 100 });
});
