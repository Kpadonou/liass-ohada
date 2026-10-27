import { randomUUID } from "crypto";
import {
  AttributeValue,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { RestaurantInventoryService as S } from "@/lambda/domains/restaurants/inventory-service";
import { InventoryRepository as R } from "@/lambda/domains/restaurants/inventory-repository";
import { RestaurantsRepository } from "@/lambda/domains/restaurants/restaurant-repository";
import {
  StockUnitSchema,
  StockItemSchema,
  isNegativeStock,
  InventoryScope,
} from "@/lambda/domains/restaurants/inventory-model";
import {
  entitySK,
  entityTypes,
} from "@/lambda/domains/restaurants/restaurant-model";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { readFileSync } from "fs";
import { resolve } from "path";
const scope = { orgId: "inventory-org", outletId: randomUUID() };
let rows: Map<string, Record<string, AttributeValue>>;
let commands: unknown[];
const key = (x: Record<string, AttributeValue>) => JSON.stringify([x.PK, x.SK]);
const fail = () =>
  Object.assign(new Error("Conflict"), {
    name: "TransactionCanceledException",
  });
let send: jest.SpyInstance;
let canonical: jest.SpyInstance;
beforeEach(() => {
  rows = new Map();
  commands = [];
  process.env.RESTAURANTS_TABLE_NAME = "inventory-test";
  canonical = jest
    .spyOn(RestaurantsRepository, "get")
    .mockImplementation(async (org, kind, parents, id) => {
      const data = { id, version: 1, outletId: scope.outletId };
      const row = marshall({
        PK: K.orgKey(org),
        SK: entitySK(kind, parents, id),
        orgId: org,
        entityType: entityTypes[kind as keyof typeof entityTypes],
        data,
      });
      rows.set(key(row), row);
      return { kind, parents, createFingerprint: "x", data } as never;
    });
  send = jest.spyOn(dynamoClient, "send").mockImplementation((async (
    command: unknown,
  ) => {
    commands.push(command);
    if (command instanceof GetItemCommand)
      return { Item: rows.get(key(command.input.Key!)) };
    if (command instanceof QueryCommand) {
      const q = command.input;
      const values = unmarshall(q.ExpressionAttributeValues!);
      let data = [...rows.values()]
        .filter(
          (r) =>
            r.PK.S === values[":pk"] && r.SK.S!.startsWith(values[":prefix"]),
        )
        .sort((a, b) => (a.SK.S! < b.SK.S! ? -1 : 1));
      if (q.ScanIndexForward === false) data.reverse();
      if (q.ExclusiveStartKey) {
        const at = data.findIndex((r) => key(r) === key(q.ExclusiveStartKey!));
        data = data.slice(at + 1);
      }
      const page = data.slice(0, q.Limit);
      return {
        Items: page,
        LastEvaluatedKey:
          data.length > page.length
            ? { PK: page.at(-1)!.PK, SK: page.at(-1)!.SK }
            : undefined,
      };
    }
    if (command instanceof TransactWriteItemsCommand) {
      for (const action of command.input.TransactItems!) {
        if (action.ConditionCheck) {
          const c = action.ConditionCheck;
          const row = rows.get(key(c.Key!));
          const stored = row && unmarshall(row);
          const values = unmarshall(c.ExpressionAttributeValues!);
          if (
            !stored ||
            stored.orgId !== values[":org"] ||
            stored.data.version !== values[":v"] ||
            (values[":type"] && stored.entityType !== values[":type"]) ||
            (values[":out"] && stored.outletId !== values[":out"])
          )
            throw fail();
        }
        if (!action.Put) continue;
        const p = action.Put;
        const old = rows.get(key(p.Item!));
        if (p.ConditionExpression === "attribute_not_exists(PK)") {
          if (old) throw fail();
        } else {
          const expected = unmarshall(p.ExpressionAttributeValues!);
          const row = old && unmarshall(old);
          if (
            !row ||
            row.orgId !== expected[":org"] ||
            row.outletId !== expected[":out"] ||
            row.entityType !== expected[":type"] ||
            row.data.version !== expected[":v"]
          )
            throw fail();
        }
      }
      for (const action of command.input.TransactItems!)
        if (action.Put) rows.set(key(action.Put.Item!), action.Put.Item!);
      return {};
    }
    throw new Error("Unexpected DynamoDB operation");
  }) as never);
});
afterEach(() => jest.restoreAllMocks());
const create = (unit = "UNIT", s = scope) =>
  S.create(s, { id: randomUUID(), name: "Drink", unit });
const move = (
  id: string,
  type = "RECEIPT",
  quantityMilli = 1000,
  businessEventId?: string,
) => ({
  stockItemId: id,
  type,
  quantityMilli,
  actorId: "owner",
  source: businessEventId ? "BUSINESS_EVENT" : "MANUAL",
  businessEventId,
});
test.each(["RECEIPT", "LOSS", "ADJUSTMENT"])(
  "manual %s requires an active item and resumes after reactivation",
  async (type) => {
    const item = await create();
    await S.applyMovement(scope, move(item.id, type));
    const current = await S.get(scope, item.id);
    const inactive = await S.update(scope, item.id, {
      expectedVersion: current.version,
      isActive: false,
    });
    const history = await S.history(scope, item.id);
    const before = new Map(rows);
    await expect(
      S.applyMovement(scope, {
        ...move(item.id, type),
        businessEventId: `MANUAL:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      messageCode: "RESTAURANTS_INVENTORY_INACTIVE",
    });
    expect(rows).toEqual(before);
    expect(await S.get(scope, item.id)).toEqual(inactive);
    expect(await S.history(scope, item.id)).toEqual(history);
    await S.update(scope, item.id, {
      expectedVersion: inactive.version,
      isActive: true,
    });
    await S.applyMovement(scope, move(item.id, type));
    expect((await S.history(scope, item.id)).items).toHaveLength(2);
  },
);
test("concurrent deactivation prevents a stale manual movement write", async () => {
  const item = await create();
  const commit = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await S.update(scope, item.id, {
      expectedVersion: item.version,
      isActive: false,
    });
    return commit(actions);
  });
  await expect(S.applyMovement(scope, move(item.id))).rejects.toMatchObject({
    messageCode: "RESTAURANTS_INVENTORY_INACTIVE",
  });
  expect((await S.get(scope, item.id)).balanceMilli).toBe(0);
  expect((await S.history(scope, item.id)).items).toEqual([]);
});
test("a retry of an accepted manual event stays idempotent after deactivation", async () => {
  const item = await create();
  const input = { ...move(item.id), businessEventId: `MANUAL:${randomUUID()}` };
  const movement = await S.applyMovement(scope, input);
  const current = await S.get(scope, item.id);
  await S.update(scope, item.id, {
    expectedVersion: current.version,
    isActive: false,
  });
  expect(await S.applyMovement(scope, input)).toEqual(movement);
  expect((await S.history(scope, item.id)).items).toHaveLength(1);
});
test("create/get/list/update metadata and preserve canonical fields", async () => {
  const a = await create();
  expect(await S.get(scope, a.id)).toEqual(a);
  expect((await S.list(scope)).items).toEqual([a]);
  const updated = await S.update(scope, a.id, {
    expectedVersion: 1,
    name: "Water",
    isActive: false,
  });
  expect(updated).toMatchObject({
    name: "Water",
    isActive: false,
    version: 2,
    balanceMilli: 0,
  });
  await expect(
    S.update(scope, a.id, { expectedVersion: 1, name: "Stale" }),
  ).rejects.toThrow();
  await expect(
    S.update(scope, a.id, { expectedVersion: 2, unit: "KG" }),
  ).rejects.toThrow();
  await expect(
    S.update(scope, a.id, { expectedVersion: 2, balanceMilli: 1000 }),
  ).rejects.toThrow();
});
test("org/outlet isolation and forged stored scope fail safely", async () => {
  const a = await create();
  for (const s of [
    { ...scope, orgId: "other" },
    { ...scope, outletId: randomUUID() },
  ]) {
    await expect(S.get(s, a.id)).rejects.toThrow();
    expect((await S.list(s)).items).toEqual([]);
  }
  const k = marshall(R.itemKey(scope, a.id));
  const stored = unmarshall(rows.get(key(k))!);
  rows.set(key(k), marshall({ ...stored, outletId: randomUUID() }));
  await expect(S.get(scope, a.id)).rejects.toThrow();
});
test.each(StockUnitSchema.options)(
  "accepts unit %s without conversion",
  async (unit) => {
    const a = await create(unit);
    const qty = ["UNIT", "BOTTLE", "CAN", "PACK"].includes(unit) ? 2000 : 1251;
    await S.applyMovement(scope, move(a.id, "RECEIPT", qty));
    expect(await S.get(scope, a.id)).toMatchObject({ unit, balanceMilli: qty });
  },
);
test.each(["UNIT", "BOTTLE", "CAN", "PACK"])(
  "rejects fractional %s",
  async (unit) => {
    const a = await create(unit);
    await expect(
      S.applyMovement(scope, move(a.id, "SALE", 1500)),
    ).rejects.toThrow();
    expect((await S.get(scope, a.id)).balanceMilli).toBe(0);
  },
);
test.each([
  ["RECEIPT", -2000, 2000],
  ["SALE", 2000, -2000],
  ["LOSS", -2000, -2000],
  ["ADJUSTMENT", 2000, 2000],
  ["ADJUSTMENT", -2000, -2000],
  ["SALE_REVERSAL", -2000, 2000],
])("normalizes %s %s", async (type, qty, expected) => {
  const a = await create();
  const movement = await S.applyMovement(
    scope,
    move(a.id, String(type), Number(qty)),
  );
  expect(movement.deltaMilli).toBe(expected);
  expect((await S.get(scope, a.id)).balanceMilli).toBe(expected);
});
test("negative stock is advisory and history remains immutable after corrections", async () => {
  const a = await create();
  await S.applyMovement(scope, move(a.id));
  const sale = await S.applyMovement(scope, move(a.id, "SALE", 3000));
  expect(isNegativeStock(await S.get(scope, a.id))).toBe(true);
  await S.applyMovement(scope, move(a.id, "SALE", 1000));
  await S.applyMovement(scope, move(a.id, "ADJUSTMENT", 10000));
  expect(
    (await S.history(scope, a.id)).items.find((m) => m.id === sale.id),
  ).toEqual(sale);
  expect(sale.resultingBalanceMilli).toBe(-2000);
  expect("deleteMovement" in S).toBe(false);
  expect("updateMovement" in S).toBe(false);
});
test("simultaneous movements retry conditional conflicts without losing either effect", async () => {
  const a = await create();
  await Promise.all([
    S.applyMovement(scope, move(a.id, "RECEIPT", 5000)),
    S.applyMovement(scope, move(a.id, "SALE", 2000)),
  ]);
  expect((await S.get(scope, a.id)).balanceMilli).toBe(3000);
  expect((await S.history(scope, a.id)).items).toHaveLength(2);
});
test("durable event receipt deduplicates repeats/concurrent events and rejects changed intent", async () => {
  const a = await create();
  const input = move(a.id, "SALE", 2000, "order:item:accept");
  const [one, two] = await Promise.all([
    S.applyMovement(scope, input),
    S.applyMovement(scope, input),
  ]);
  expect(one).toEqual(two);
  expect(await S.applyMovement(scope, input)).toEqual(one);
  expect((await S.get(scope, a.id)).balanceMilli).toBe(-2000);
  expect((await S.history(scope, a.id)).items).toHaveLength(1);
  await expect(
    S.applyMovement(scope, { ...input, quantityMilli: 3000 }),
  ).rejects.toThrow();
  const tx = commands
    .filter(
      (c): c is TransactWriteItemsCommand =>
        c instanceof TransactWriteItemsCommand,
    )
    .find((c) => c.input.TransactItems?.length === 3)!;
  expect(tx).toBeDefined();
  expect(JSON.stringify(tx.input)).not.toMatch(/TTL|expiresAt/);
});
test("bounded newest-first deterministic query and scope-bound cursors", async () => {
  const a = await create();
  for (let i = 0; i < 3; i++) await S.applyMovement(scope, move(a.id));
  const first = await S.history(scope, a.id, { limit: 2 });
  const next = await S.history(scope, a.id, {
    limit: 2,
    cursor: first.nextCursor,
  });
  expect(first.items).toHaveLength(2);
  expect(next.items).toHaveLength(1);
  const all = [...first.items, ...next.items];
  expect(
    all.map((m) => K.restaurantStockMovementSK(m.createdAt, m.id)),
  ).toEqual(
    all
      .map((m) => K.restaurantStockMovementSK(m.createdAt, m.id))
      .sort()
      .reverse(),
  );
  await expect(
    S.history({ ...scope, outletId: randomUUID() }, a.id, {
      cursor: first.nextCursor,
    }),
  ).rejects.toThrow();
  await expect(S.history(scope, a.id, { limit: 101 })).rejects.toThrow();
  for (const c of commands)
    if (c instanceof QueryCommand)
      expect(c.input).toMatchObject({
        ConsistentRead: true,
        ScanIndexForward: false,
        Limit: 2,
      });
});
test("mapping permits one discrete no-station item and resolves canonical scope", async () => {
  const a = await create("BOTTLE");
  const input = {
    menuItemId: randomUUID(),
    categoryId: randomUUID(),
    stockItemId: a.id,
    actorId: "owner",
  };
  const mapping = await S.mapMenuItem(scope, input);
  expect(await S.resolveMapping(scope, input.menuItemId)).toEqual(mapping);
  await expect(
    S.mapMenuItem(scope, { ...input, stockItemId: (await create()).id }),
  ).rejects.toThrow();
  await expect(
    S.mapMenuItem({ ...scope, outletId: randomUUID() }, input),
  ).rejects.toThrow();
  canonical.mockResolvedValue({
    data: {
      id: input.menuItemId,
      outletId: scope.outletId,
      version: 1,
      preparationStationId: randomUUID(),
    },
  });
  await expect(
    S.mapMenuItem(scope, { ...input, menuItemId: randomUUID() }),
  ).rejects.toThrow();
});
test("mapping rejects continuous stock and foreign canonical menu outlet", async () => {
  const a = await create("KG");
  const input = {
    menuItemId: randomUUID(),
    categoryId: randomUUID(),
    stockItemId: a.id,
    actorId: "owner",
  };
  await expect(S.mapMenuItem(scope, input)).rejects.toThrow();
  const b = await create();
  canonical.mockResolvedValue({ data: { outletId: randomUUID(), version: 1 } });
  await expect(
    S.mapMenuItem(scope, { ...input, stockItemId: b.id }),
  ).rejects.toThrow();
});
test("invalid quantities, missing outlet, overflow, and unsupported fields fail", async () => {
  canonical.mockResolvedValue(undefined);
  await expect(create()).rejects.toThrow();
  canonical.mockImplementation(async (org, kind, parents, id) => {
    const row = marshall({
      PK: K.orgKey(org),
      SK: entitySK(kind, parents, id),
      orgId: org,
      entityType: entityTypes[kind as keyof typeof entityTypes],
      data: { version: 1 },
    });
    rows.set(key(row), row);
    return { data: { version: 1 } } as never;
  });
  const a = await create("KG");
  for (const qty of [0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      S.applyMovement(scope, move(a.id, "RECEIPT", qty)),
    ).rejects.toThrow();
  await S.applyMovement(scope, move(a.id, "RECEIPT", Number.MAX_SAFE_INTEGER));
  await expect(
    S.applyMovement(scope, move(a.id, "RECEIPT", 1)),
  ).rejects.toThrow();
});
test("inventory has no Scan, index, infrastructure or sales hooks", () => {
  for (const file of [
    "inventory-model.ts",
    "inventory-repository.ts",
    "inventory-service.ts",
  ]) {
    const source = readFileSync(
      resolve(__dirname, "../../../lambda/domains/restaurants", file),
      "utf8",
    );
    expect(source).not.toMatch(
      /ScanCommand|IndexName|GSI\d|aws-cdk|submit-order/,
    );
  }
  expect(StockItemSchema.safeParse({}).success).toBe(false);
});

test("unmapped menu items resolve empty and cross-org mappings fail", async () => {
  expect(await S.resolveMapping(scope, randomUUID())).toBeUndefined();
  const item = await create();
  await expect(
    S.mapMenuItem(
      { ...scope, orgId: "foreign" },
      {
        menuItemId: randomUUID(),
        categoryId: randomUUID(),
        stockItemId: item.id,
        actorId: "owner",
      },
    ),
  ).rejects.toThrow();
});
test("history cannot be overwritten through versioned inventory writes", () => {
  expect(() =>
    R.put(
      scope,
      {
        PK: K.restaurantStockHistoryPK(
          scope.orgId,
          scope.outletId,
          randomUUID(),
        ),
        SK: K.restaurantStockMovementSK(new Date().toISOString(), randomUUID()),
      },
      "RESTAURANT_STOCK_MOVEMENT",
      {},
      1,
    ),
  ).toThrow();
});
test("metadata conflict leaves balance and history intact", async () => {
  const item = await create();
  await S.applyMovement(scope, move(item.id));
  await expect(
    S.update(scope, item.id, { expectedVersion: 1, name: "Stale" }),
  ).rejects.toThrow();
  expect((await S.get(scope, item.id)).balanceMilli).toBe(1000);
  expect((await S.history(scope, item.id)).items).toHaveLength(1);
});
