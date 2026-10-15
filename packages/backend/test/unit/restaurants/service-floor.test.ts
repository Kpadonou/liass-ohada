import {
  BatchGetItemCommand,
  BatchGetItemCommandInput,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionQueries as Q } from "@/lambda/domains/restaurants/transaction-queries";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { restaurantBatchRead } from "@/lambda/domains/restaurants/restaurant-batch-read";
import { restaurantsTableName } from "@/lambda/domains/restaurants/restaurant-storage";
import { acceptanceFixture } from "./acceptance-fixture";
import { fixtureId, memoryDynamo } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>;
let scope: { orgId: string; outletId: string; actorId: string };
let sequence: number;
const req = () => fixtureId(++sequence);
const floor = async (request: object = {}, context = scope) =>
  c.RestaurantServiceFloorResponseSchema.parse(
    await Q.run(context, "SERVICE_FLOOR", request),
  );
const open = (index = 0, clientRequestId = req()) =>
  S.mutate(scope, "OPEN_SESSION", {
    tableId: f.tables[index].id,
    areaId: f.tables[index].serviceAreaId,
    clientRequestId,
  });
const call = (
  name: string,
  body: object = {},
  actor = "owner",
  orgId = scope.orgId,
  outletId = scope.outletId,
  query: object = {},
) =>
  restaurantTransactionHandler(name)({
    headers: { "x-org-id": orgId, "accept-language": "en" },
    body: JSON.stringify(body),
    pathParameters: { outletId },
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
beforeEach(async () => {
  m = memoryDynamo();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  scope = { orgId: "org-resto", outletId: f.outlet.id, actorId: "owner" };
  m.seedAccess("org-resto", "owner", "OWNER");
  sequence = 1000;
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("outlet page joins all areas, returns free tables, and refresh is stable", async () => {
  m.db.resetHistory();
  const result = await floor();
  expect(result.items).toHaveLength(4);
  expect(
    result.items.every(
      (t) => t.state === "FREE" && t.capacity === 4 && t.areaName,
    ),
  ).toBe(true);
  expect(await floor()).toEqual(result);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  for (const call of m.db.commandCalls(QueryCommand)) {
    expect(call.args[0].input).toMatchObject({
      TableName: restaurantsTableName(),
      ConsistentRead: true,
      Limit: 50,
    });
    expect(call.args[0].input.FilterExpression).toBeUndefined();
    expect(
      unmarshall(call.args[0].input.ExpressionAttributeValues!)[":prefix"],
    ).toBe(K.restaurantOutletTablePrefix(scope.outletId));
  }
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(4); // two batches/read when all free
});
test("empty outlet and an inactive-only page return no fake tables", async () => {
  const outlet = await Config.create(
    scope.orgId,
    "owner",
    "outlet",
    {},
    { name: "Empty", clientRequestId: req() },
  );
  expect((await floor({}, { ...scope, outletId: outlet.id })).items).toEqual(
    [],
  );
  for (const t of f.tables)
    await Config.update(
      scope.orgId,
      "owner",
      "table",
      { outletId: scope.outletId, serviceAreaId: t.serviceAreaId },
      t.id,
      { expectedVersion: t.version },
      "deactivate",
    );
  expect((await floor()).items).toEqual([]);
});
test("capacity is optional and omitted rather than fabricated", async () => {
  const t = await Config.create(
    scope.orgId,
    "owner",
    "table",
    { outletId: scope.outletId, serviceAreaId: f.areas[0].id },
    { name: "Bench", code: "B1", clientRequestId: req() },
  );
  expect(
    (await floor()).items.find((i) => i.tableId === t.id),
  ).not.toHaveProperty("capacity");
});
test("mixed floor exposes real session, actor, currency and canonical commercial total", async () => {
  const session = c.GuestSessionSchema.parse((await open()).data);
  let occupied = (await floor()).items.find(
    (t) => t.tableId === session.tableId,
  );
  expect(occupied).toMatchObject({
    state: "OCCUPIED",
    guestSessionId: session.guestSessionId,
    openedAt: session.openedAt,
    openedBy: "owner",
    currentAmountMinor: 0,
    orderCount: 0,
    currency: "XOF",
  });
  const order = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(scope, "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  const item = c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        scope,
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: 1,
          menuItemId: f.items[0].id,
          categoryId: f.items[0].categoryId,
          expectedMenuItemVersion: 1,
          quantity: 2,
        },
        { orderId: order.orderId },
      )
    ).data,
  );
  expect(
    (await floor()).items.find((t) => t.tableId === session.tableId),
  ).toMatchObject({ currentAmountMinor: 0, orderCount: 1 });
  await S.mutate(
    scope,
    "SUBMIT_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: 2,
      items: [{ itemId: item.itemId, expectedVersion: 1 }],
    },
    { orderId: order.orderId },
  );
  occupied = (await floor()).items.find((t) => t.tableId === session.tableId);
  expect(occupied).toMatchObject({
    currentAmountMinor: 10000,
    orderCount: 1,
    currency: "XOF",
  });
  await S.mutate(
    scope,
    "CANCEL_ITEM",
    {
      clientRequestId: req(),
      expectedVersion: 3,
      expectedItemVersion: 2,
      reason: "Correction",
    },
    { orderId: order.orderId, itemId: item.itemId },
  );
  expect(
    (await floor()).items.find((t) => t.tableId === session.tableId),
  ).toMatchObject({ currentAmountMinor: 0, orderCount: 1 });
  await S.mutate(
    scope,
    "CANCEL_ORDER",
    { clientRequestId: req(), expectedVersion: 4, reason: "Correction" },
    { orderId: order.orderId },
  );
  expect(
    (await floor()).items.find((t) => t.tableId === session.tableId),
  ).toMatchObject({ currentAmountMinor: 0, orderCount: 1 });
  expect((await floor()).items.filter((t) => t.state === "FREE")).toHaveLength(
    3,
  );
  expect(JSON.stringify(occupied)).not.toMatch(
    /waiter|partySize|paidMinor|PK|SK/,
  );
});
test("concurrent openings have one winner, durable retry and safe empty correction", async () => {
  const id = req();
  const attempts = await Promise.allSettled([open(0, id), open(0, req())]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const winner = attempts.find(
    (a) => a.status === "fulfilled",
  ) as PromiseFulfilledResult<Awaited<ReturnType<typeof open>>>;
  const s = c.GuestSessionSchema.parse(winner.value.data);
  if (attempts[0].status === "fulfilled")
    expect(await open(0, id)).toEqual(winner.value);
  await expect(open()).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (await floor()).items.filter((t) => t.state === "OCCUPIED"),
  ).toHaveLength(1);
  await S.mutate(
    scope,
    "CLOSE_SESSION",
    { clientRequestId: req(), expectedVersion: s.version },
    { sessionId: s.guestSessionId },
  );
  expect((await floor()).items.every((t) => t.state === "FREE")).toBe(true);
});
test("inactive table and wrong outlet/area cannot open", async () => {
  const t = f.tables[0];
  await Config.update(
    scope.orgId,
    "owner",
    "table",
    { outletId: scope.outletId, serviceAreaId: t.serviceAreaId },
    t.id,
    { expectedVersion: 1 },
    "deactivate",
  );
  await expect(open()).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    S.mutate(scope, "OPEN_SESSION", {
      clientRequestId: req(),
      tableId: f.tables[1].id,
      areaId: f.areas[0].id,
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
  const other = await Config.create(
    scope.orgId,
    "owner",
    "outlet",
    {},
    { clientRequestId: req(), name: "Other" },
  );
  await expect(
    S.mutate({ ...scope, outletId: other.id }, "OPEN_SESSION", {
      clientRequestId: req(),
      tableId: f.tables[1].id,
      areaId: f.tables[1].serviceAreaId,
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
});
test("cursors traverse all tables and bind organization/outlet/collection", async () => {
  const first = await floor({ limit: 1 });
  const all = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await floor({ limit: 1, cursor });
    all.push(...page.items);
    cursor = page.nextCursor;
  }
  expect(new Set(all.map((t) => t.tableId)).size).toBe(4);
  const other = await Config.create(
    scope.orgId,
    "owner",
    "outlet",
    {},
    { clientRequestId: req(), name: "Other" },
  );
  await expect(
    floor({ cursor: first.nextCursor }, { ...scope, outletId: other.id }),
  ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  await acceptanceFixture("another-org");
  await expect(
    floor({ cursor: first.nextCursor }, { ...scope, orgId: "another-org" }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(floor({ cursor: "garbage" })).rejects.toMatchObject({
    statusCode: 400,
  });
});
test.each(["OWNER", "MANAGER"])(
  "%s uses existing session read/open permissions",
  async (role) => {
    m.seedAccess(scope.orgId, "owner", role);
    const result = await call("service-floor");
    expect(result.statusCode).toBe(200);
    expect(
      c.RestaurantServiceFloorResponseSchema.safeParse(JSON.parse(result.body))
        .success,
    ).toBe(true);
    expect(
      (
        await call("open-session", {
          clientRequestId: req(),
          tableId: f.tables[0].id,
          areaId: f.tables[0].serviceAreaId,
        })
      ).statusCode,
    ).toBe(200);
  },
);
test.each(["WAITER", "CASHIER", "KITCHEN"])(
  "%s remains transaction read/write restricted",
  async (role) => {
    m.seedAccess(scope.orgId, "owner", role);
    expect((await call("service-floor")).statusCode).toBe(403);
    expect(
      (
        await call("open-session", {
          clientRequestId: req(),
          tableId: f.tables[0].id,
          areaId: f.tables[0].serviceAreaId,
        })
      ).statusCode,
    ).toBe(403);
  },
);
test("foreign organization, absent entitlement and malformed paths/inputs fail closed", async () => {
  m.seedAccess(scope.orgId, "owner", "OWNER");
  expect(
    (await call("service-floor", {}, "owner", "foreign-org")).statusCode,
  ).toBe(403);
  expect(
    (await call("service-floor", {}, "owner", scope.orgId, "not-uuid"))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await call("service-floor", {}, "owner", scope.orgId, scope.outletId, {
        limit: 101,
      })
    ).statusCode,
  ).toBe(400);
  m.rows.delete(
    JSON.stringify([K.orgKey(scope.orgId), K.productAccessSK("RESTAURANTS")]),
  );
  expect((await call("service-floor")).statusCode).toBe(403);
});
test("incomplete batches retry boundedly and never report false free occupancy", async () => {
  m.db
    .on(BatchGetItemCommand)
    .callsFake(async (input: BatchGetItemCommandInput) => ({
      UnprocessedKeys: input.RequestItems,
    }));
  await expect(floor()).rejects.toMatchObject({ statusCode: 503 });
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(3);
});
test("a partial batch can recover without losing found rows", async () => {
  const key = {
    PK: K.orgKey(scope.orgId),
    SK: K.restaurantOutletSK(scope.outletId),
  };
  let attempt = 0;
  m.db
    .on(BatchGetItemCommand)
    .callsFake(async (input: BatchGetItemCommandInput) =>
      ++attempt === 1
        ? { UnprocessedKeys: input.RequestItems }
        : {
            Responses: {
              [restaurantsTableName()]: [
                m.rows.get(JSON.stringify([key.PK, key.SK]))!,
              ],
            },
          },
    );
  const result = await restaurantBatchRead([key]);
  expect(result[0]).toBeDefined();
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(2);
});
test("stale/corrupt occupancy fails rather than fabricating current state", async () => {
  const s = c.GuestSessionSchema.parse((await open()).data);
  const pk = K.restaurantSessionPK(
    scope.orgId,
    scope.outletId,
    s.guestSessionId,
  );
  const key = JSON.stringify([pk, "META"]);
  const row = unmarshall(m.rows.get(key)!);
  m.rows.set(
    key,
    marshall({ ...row, data: { ...row.data, tableId: fixtureId(9999) } }),
  );
  await expect(floor()).rejects.toMatchObject({
    messageCode: "RESTAURANTS_TRANSACTION_INTEGRITY",
  });
});
test("public contracts reject fake states, leaked keys and fractional money", () => {
  const base = {
    tableId: f.tables[0].id,
    code: "T01",
    areaId: f.areas[0].id,
    state: "FREE",
  };
  for (const invalid of [
    { ...base, state: "CALL_WAITER" },
    { ...base, PK: "secret" },
    { ...base, guestCount: 2 },
  ])
    expect(c.RestaurantServiceFloorTableSchema.safeParse(invalid).success).toBe(
      false,
    );
  const occupied = {
    ...base,
    state: "OCCUPIED",
    guestSessionId: fixtureId(9999),
    openedAt: new Date().toISOString(),
    openedBy: "owner",
    currency: "XOF",
    currentAmountMinor: 1.5,
  };
  expect(c.RestaurantServiceFloorTableSchema.safeParse(occupied).success).toBe(
    false,
  );
});

test("zero-priced accepted sale retains order activity with bounded floor hydration", async () => {
  const source = f.items[0];
  await Config.update(
    scope.orgId,
    "owner",
    "item",
    { outletId: scope.outletId, categoryId: source.categoryId },
    source.id,
    { expectedVersion: 1, price: { amountMinor: 0, currency: "XOF" } },
  );
  const session = c.GuestSessionSchema.parse((await open()).data);
  const order = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(scope, "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  const item = c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        scope,
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: 1,
          menuItemId: source.id,
          categoryId: source.categoryId,
          expectedMenuItemVersion: 2,
          quantity: 1,
        },
        { orderId: order.orderId },
      )
    ).data,
  );
  await S.mutate(
    scope,
    "SUBMIT_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: 2,
      items: [{ itemId: item.itemId, expectedVersion: 1 }],
    },
    { orderId: order.orderId },
  );
  m.db.resetHistory();
  const result = await floor();
  const occupied = result.items.find((t) => t.tableId === session.tableId)!;
  expect(occupied).toMatchObject({
    state: "OCCUPIED",
    currentAmountMinor: 0,
    orderCount: 1,
  });
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
  expect(m.db.commandCalls(BatchGetItemCommand)).toHaveLength(3);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(
    c.RestaurantServiceFloorResponseSchema.safeParse({
      ...result,
      items: [{ ...occupied, orderCount: -1 }],
    }).success,
  ).toBe(false);
  expect(
    c.RestaurantServiceFloorResponseSchema.safeParse({
      ...result,
      items: [{ ...occupied, madeUp: true }],
    }).success,
  ).toBe(false);
  const { orderCount, ...legacy } = occupied as Extract<
    c.RestaurantServiceFloorResponse["items"][number],
    { state: "OCCUPIED" }
  >;
  expect(
    c.RestaurantServiceFloorResponseSchema.safeParse({
      ...result,
      items: [legacy],
    }).success,
  ).toBe(true);
});
