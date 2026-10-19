import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantServiceAccess as Access } from "@/lambda/domains/restaurants/service-access";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { RESTAURANT_TRANSACTION_ROUTES } from "@/lambda/domains/restaurants/transaction-routes";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId } from "./memory-dynamo";
const org = "org-resto";
const reads = ["session-orders", "get-order", "order-items"] as const;
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  session: c.GuestSessionRead,
  order: c.RestaurantOrder,
  seq: number;
const request = () => fixtureId(++seq);
const scope = () => ({ orgId: org, outletId: f.outlet.id, actorId: "owner" });
function call(
  name: string,
  actor = "Aissa",
  body: object = {},
  ids: object = {},
  query: object = {},
  outletId = f.outlet.id,
  tenant = org,
) {
  return restaurantTransactionHandler(name)({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    body: JSON.stringify(body),
    pathParameters: { outletId, ...ids },
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
const read = (
  name: (typeof reads)[number],
  actor = "Aissa",
  query: object = {},
  outletId = f.outlet.id,
  tenant = org,
) =>
  call(
    name,
    actor,
    {},
    name === "session-orders"
      ? { sessionId: session.guestSessionId }
      : { orderId: order.orderId },
    query,
    outletId,
    tenant,
  );
function patch(
  key: { PK: string; SK: string },
  changes: Record<string, unknown>,
) {
  const old = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
  m.rows.set(
    JSON.stringify([key.PK, key.SK]),
    marshall({ ...old, ...changes }, { removeUndefinedValues: true }),
  );
}
async function person(id: string, assigned = true) {
  m.seedAccess(org, id, "WAITER");
  await Staff.mutate(org, "owner", id, "BIND", {
    clientRequestId: request(),
    memberUserId: id,
    operationalLabel: `${id} S.`,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "owner",
      id,
      "ASSIGN",
      { clientRequestId: request() },
      f.outlet.id,
    );
}
async function createOrder(guestSessionId = session.guestSessionId) {
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate(scope(), "CREATE_ORDER", {
        clientRequestId: request(),
        orderType: "DINE_IN",
        guestSessionId,
      })
    ).data,
  );
}
async function add(index = 0, orderId = order.orderId) {
  const current = (await S.order(scope(), orderId)).data;
  const item = f.items[index];
  return c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        scope(),
        "ADD_ITEM",
        {
          clientRequestId: request(),
          expectedVersion: current.version,
          menuItemId: item.id,
          categoryId: item.categoryId,
          expectedMenuItemVersion: item.version,
          quantity: 1,
        },
        { orderId },
      )
    ).data,
  );
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 20000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("Aissa");
  await person("Binta");
  const opened = await call("open-session", "Binta", {
    clientRequestId: request(),
    tableId: f.tables[0].id,
    areaId: f.tables[0].serviceAreaId,
  });
  expect(opened.statusCode).toBe(200);
  session = c.GuestSessionResponseSchema.parse(JSON.parse(opened.body)).data;
  order = await createOrder();
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test.each([
  "OWNER",
  "MANAGER",
  "WAITER",
  "CASHIER",
  "KITCHEN",
  "INVALID",
  undefined,
])("explicit narrow role projection: %s", (role) => {
  const permissions = Auth.permissionsForRestaurantsRole(role);
  expect(permissions.includes("RESTAURANTS_SERVICE_ORDER_READ")).toBe(
    ["OWNER", "MANAGER", "WAITER"].includes(role ?? ""),
  );
  if (role === "WAITER") {
    expect(permissions).not.toContain("RESTAURANTS_ORDER_READ");
    for (const permission of permissions)
      if (permission.startsWith("RESTAURANTS_ORDER_"))
        throw new Error("Broad order grant");
  }
});
test("only three existing routes consume the new permission; discovery stays legacy", () => {
  expect(
    RESTAURANT_TRANSACTION_ROUTES.filter(
      (r) => r.permission === "RESTAURANTS_SERVICE_ORDER_READ",
    ).map((r) => r.name),
  ).toEqual(["get-order", "session-orders", "order-items"]);
  expect(
    RESTAURANT_TRANSACTION_ROUTES.filter(
      (r) => r.permission === "RESTAURANTS_ORDER_READ",
    ).map((r) => r.name),
  ).toEqual([
    "active-orders",
    "unpaid-orders",
    "table-orders",
    "order-history",
  ]);
});
test.each(reads)(
  "assigned waiter reads %s across responsibility boundaries without writes",
  async (name) => {
    const before = new Map(m.rows),
      transactions = m.transactions.length;
    const gate = jest.spyOn(Access, "authorize");
    const result = await read(name);
    expect(result.statusCode).toBe(200);
    expect(session.responsibleStaff?.staffId).toBe("Binta");
    expect(order.createdBy).toBe("owner");
    expect(gate).toHaveBeenCalledTimes(1);
    expect(m.rows).toEqual(before);
    expect(m.transactions).toHaveLength(transactions);
    expect(result.body).not.toMatch(/"(?:PK|SK|GSI1PK|entityType)"/);
  },
);
test("accepted snapshots and draft semantics survive menu changes; item pagination remains bounded", async () => {
  const first = await add(0);
  const second = await add(1);
  const current = (await S.order(scope(), order.orderId)).data;
  await S.mutate(
    scope(),
    "SUBMIT_ORDER",
    {
      clientRequestId: request(),
      expectedVersion: current.version,
      items: [{ itemId: first.itemId, expectedVersion: first.version }],
    },
    { orderId: order.orderId },
  );
  await Config.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: f.items[0].categoryId },
    f.items[0].id,
    {
      expectedVersion: 1,
      name: "Changed menu name",
      price: { amountMinor: 9900, currency: "XOF" },
    },
  );
  const result = await read("order-items");
  expect(result.statusCode).toBe(200);
  const lines = c.RestaurantOrderItemListResponseSchema.parse(
    JSON.parse(result.body),
  ).items;
  expect(lines.find((line) => line.itemId === first.itemId)).toMatchObject({
    status: "ACCEPTED",
    snapshot: { name: "Grilled Chicken", unitPriceMinor: 5000 },
  });
  expect(lines.find((line) => line.itemId === second.itemId)).toMatchObject({
    status: "DRAFT",
  });
  expect(
    lines.find((line) => line.itemId === second.itemId),
  ).not.toHaveProperty("snapshot");
  const one = c.RestaurantOrderItemListResponseSchema.parse(
    JSON.parse((await read("order-items", "Aissa", { limit: "1" })).body),
  );
  expect(one.items).toHaveLength(1);
  expect(one.nextCursor).toBeDefined();
  const two = c.RestaurantOrderItemListResponseSchema.parse(
    JSON.parse(
      (
        await read("order-items", "Aissa", {
          limit: "1",
          cursor: one.nextCursor,
        })
      ).body,
    ),
  );
  expect(two.items).toHaveLength(1);
  expect(two.items[0].itemId).not.toBe(one.items[0].itemId);
  const other = await createOrder();
  expect(
    (
      await call(
        "order-items",
        "Aissa",
        {},
        { orderId: other.orderId },
        { cursor: one.nextCursor },
      )
    ).statusCode,
  ).toBe(400);
});
test.each(["owner", "manager"])(
  "%s retains standalone, CLOSED-session and broad historical/list reads without staff",
  async (actor) => {
    expect(await SR.get(org, SR.staffKey(org, actor), "STAFF")).toBeUndefined();
    for (const name of reads)
      expect((await read(name, actor)).statusCode).toBe(200);
    await S.mutate(
      scope(),
      "CANCEL_ORDER",
      { clientRequestId: request(), expectedVersion: 1, reason: "Unused" },
      { orderId: order.orderId },
    );
    const current = (await S.session(scope(), session.guestSessionId)).data;
    await S.mutate(
      scope(),
      "CLOSE_SESSION",
      { clientRequestId: request(), expectedVersion: current.version },
      { sessionId: session.guestSessionId },
    );
    for (const name of reads) {
      expect((await read(name, actor)).statusCode).toBe(200);
      expect((await read(name)).statusCode).toBe(404);
    }
    const standalone = c.RestaurantOrderSchema.parse(
      (
        await S.mutate(scope(), "CREATE_ORDER", {
          clientRequestId: request(),
          orderType: "TAKEAWAY",
        })
      ).data,
    );
    expect(
      (await call("get-order", actor, {}, { orderId: standalone.orderId }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call("order-items", actor, {}, { orderId: standalone.orderId }))
        .statusCode,
    ).toBe(200);
    for (const name of [
      "active-orders",
      "unpaid-orders",
      "table-orders",
      "order-history",
    ]) {
      const ids = name === "table-orders" ? { tableId: session.tableId } : {};
      const query =
        name === "order-history"
          ? {
              start: "2020-01-01T00:00:00.000Z",
              end: "2020-01-02T00:00:00.000Z",
            }
          : {};
      expect((await call(name, actor, {}, ids, query)).statusCode).toBe(200);
    }
  },
);
test.each(["TAKEAWAY", "COUNTER"])(
  "standalone %s is indistinguishable from missing Order to waiter",
  async (orderType) => {
    const standalone = c.RestaurantOrderSchema.parse(
      (
        await S.mutate(scope(), "CREATE_ORDER", {
          clientRequestId: request(),
          orderType,
        })
      ).data,
    );
    for (const name of ["get-order", "order-items"]) {
      const response = await call(
        name,
        "Aissa",
        {},
        { orderId: standalone.orderId },
      );
      expect(response.statusCode).toBe(404);
      expect(response).toEqual(
        await call(name, "Aissa", {}, { orderId: fixtureId(99999) }),
      );
    }
  },
);

test.each([
  "staff",
  "assignment",
  "deleted-assignment",
  "membership",
  "product",
  "role",
  "missing-role",
  "inactive-outlet",
])(
  "revocation of %s denies all three reads before transactional lookup",
  async (change) => {
    for (const name of reads) expect((await read(name)).statusCode).toBe(200);
    // Even references naming Aissa cannot authorize access after assignment revocation.
    patch(
      {
        PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
        SK: "META",
      },
      {
        data: {
          ...(await S.session(scope(), session.guestSessionId)).data,
          responsibleStaffId: "Aissa",
        },
      },
    );
    patch(
      { PK: K.restaurantOrderPK(org, f.outlet.id, order.orderId), SK: "META" },
      { data: { ...order, waiterId: "Aissa" } },
    );
    if (change === "staff")
      await Staff.mutate(org, "owner", "Aissa", "UPDATE", {
        clientRequestId: request(),
        expectedVersion: 1,
        status: "INACTIVE",
      });
    if (change === "assignment")
      await Staff.mutate(
        org,
        "owner",
        "Aissa",
        "UNASSIGN",
        { clientRequestId: request(), expectedVersion: 1 },
        f.outlet.id,
      );
    if (change === "deleted-assignment") {
      const key = SR.assignmentKeys(org, "Aissa", f.outlet.id)[0];
      m.rows.delete(JSON.stringify([key.PK, key.SK]));
    }
    if (change === "membership")
      patch(
        { PK: K.orgKey(org), SK: K.orgUserAccessSK("Aissa") },
        { status: "INACTIVE" },
      );
    if (change === "product")
      patch(
        { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
        { status: "INACTIVE" },
      );
    if (change === "role") m.seedAccess(org, "Aissa", "KITCHEN");
    if (change === "missing-role")
      patch(
        { PK: K.orgKey(org), SK: K.orgUserAccessSK("Aissa") },
        { productRoles: {} },
      );
    if (change === "inactive-outlet")
      await Config.update(
        org,
        "owner",
        "outlet",
        {},
        f.outlet.id,
        { expectedVersion: 1 },
        "deactivate",
      );
    const lookup = jest.spyOn(S, "order"),
      sessionLookup = jest.spyOn(S, "session");
    for (const name of reads) expect((await read(name)).statusCode).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    expect(sessionLookup).not.toHaveBeenCalled();
  },
);
test.each(["KITCHEN", "UNKNOWN"])("denies %s before lookup", async (role) => {
  m.seedAccess(org, "Aissa", role);
  const lookup = jest.spyOn(S, "order");
  for (const name of reads) expect((await read(name)).statusCode).toBe(403);
  expect(lookup).not.toHaveBeenCalled();
});
test("unassigned and wrong-outlet waiters fail closed; missing/foreign keys expose no data", async () => {
  await person("unassigned", false);
  const other = await Config.create(
    org,
    "owner",
    "outlet",
    {},
    { clientRequestId: request(), name: "Other outlet" },
  );
  for (const name of reads) {
    expect((await read(name, "unassigned")).statusCode).toBe(403);
    expect((await read(name, "Aissa", {}, other.id)).statusCode).toBe(403);
  }
  await Staff.mutate(
    org,
    "owner",
    "Aissa",
    "ASSIGN",
    { clientRequestId: request() },
    other.id,
  );
  for (const name of reads)
    expect((await read(name, "Aissa", {}, other.id)).statusCode).toBe(404);
  m.seedAccess("foreign", "Aissa", "OWNER");
  for (const name of reads) {
    const foreign = await read(name, "Aissa", {}, f.outlet.id, "foreign");
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(order.orderId);
    expect(foreign.body).not.toContain(session.guestSessionId);
  }
});
test("session pagination and ownership cannot be confused with another OPEN session", async () => {
  await createOrder();
  const one = c.RestaurantOrderListResponseSchema.parse(
    JSON.parse((await read("session-orders", "Aissa", { limit: "1" })).body),
  );
  expect(one.items).toHaveLength(1);
  expect(one.nextCursor).toBeDefined();
  const next = c.RestaurantOrderListResponseSchema.parse(
    JSON.parse(
      (
        await read("session-orders", "Aissa", {
          limit: "1",
          cursor: one.nextCursor,
        })
      ).body,
    ),
  );
  expect(next.items).toHaveLength(1);
  expect(next.items[0].orderId).not.toBe(one.items[0].orderId);
  const other = c.GuestSessionSchema.parse(
    (
      await S.mutate(scope(), "OPEN_SESSION", {
        clientRequestId: request(),
        tableId: f.tables[1].id,
        areaId: f.tables[1].serviceAreaId,
      })
    ).data,
  );
  const otherOrder = await createOrder(other.guestSessionId);
  expect(
    (
      await call(
        "session-orders",
        "Aissa",
        {},
        { sessionId: other.guestSessionId },
        { cursor: one.nextCursor },
      )
    ).statusCode,
  ).toBe(400);
  const otherPage = await call(
    "session-orders",
    "Aissa",
    {},
    { sessionId: other.guestSessionId },
  );
  expect(
    JSON.parse(otherPage.body).items.map((o: c.RestaurantOrder) => o.orderId),
  ).toEqual([otherOrder.orderId]);
  // Corrupted locator under requested session must fail, never expose another visit's Order.
  const key = {
    PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
    SK: K.restaurantSessionOrderSK(order.createdAt, order.orderId),
  };
  const row = unmarshall(m.rows.get(JSON.stringify([key.PK, key.SK]))!);
  patch(key, { data: { ...row.data, targetId: otherOrder.orderId } });
  const bad = await read("session-orders");
  expect(bad.statusCode).toBe(409);
  expect(bad.body).not.toContain(otherOrder.orderId);
});
test("authorization is once per request, independent of page size, using consistent bounded reads", async () => {
  await createOrder();
  const gate = jest.spyOn(Access, "authorize");
  m.db.resetHistory();
  expect(
    (await read("session-orders", "Aissa", { limit: "1" })).statusCode,
  ).toBe(200);
  const count = m.db.commandCalls(GetItemCommand).length;
  expect(gate).toHaveBeenCalledTimes(1);
  gate.mockClear();
  m.db.resetHistory();
  expect(
    (await read("session-orders", "Aissa", { limit: "2" })).statusCode,
  ).toBe(200);
  expect(gate).toHaveBeenCalledTimes(1);
  expect(m.db.commandCalls(GetItemCommand)).toHaveLength(count + 1); // canonical order hydration only
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(1);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(
    m.db
      .commandCalls(GetItemCommand)
      .every((call) => call.args[0].input.ConsistentRead === true),
  ).toBe(true);
});
test.each(["active-orders", "unpaid-orders", "table-orders", "order-history"])(
  "legacy %s stays denied despite new permission",
  async (name) => {
    const result = await call(
      name,
      "Aissa",
      {},
      { ...(name === "table-orders" ? { tableId: session.tableId } : {}) },
      name === "order-history"
        ? { start: "2026-10-15T00:00:00.000Z", end: "2026-10-16T00:00:00.000Z" }
        : {},
    );
    expect(result.statusCode).toBe(403);
  },
);
test("exception mutations remain denied through real handlers", async () => {
  const item = await add();
  await S.mutate(
    scope(),
    "SUBMIT_ORDER",
    {
      clientRequestId: request(),
      expectedVersion: 2,
      items: [{ itemId: item.itemId, expectedVersion: 1 }],
    },
    { orderId: order.orderId },
  );
  const common = { clientRequestId: request(), expectedVersion: 3 };
  for (const [name, body] of Object.entries({
    "cancel-order-item": {
      ...common,
      expectedItemVersion: 2,
      reason: "Exception",
    },
    "cancel-order": { ...common, reason: "Exception" },
    "close-order": common,
  })) {
    expect(
      (
        await call(name, "Aissa", body, {
          orderId: order.orderId,
          ...(name === "cancel-order-item" ? { itemId: item.itemId } : {}),
        })
      ).statusCode,
    ).toBe(403);
  }
});

test("canonical parent mismatch and missing parent never authorize item content", async () => {
  const other = c.GuestSessionSchema.parse(
    (
      await S.mutate(scope(), "OPEN_SESSION", {
        clientRequestId: request(),
        tableId: f.tables[1].id,
        areaId: f.tables[1].serviceAreaId,
      })
    ).data,
  );
  const key = {
    PK: K.restaurantOrderPK(org, f.outlet.id, order.orderId),
    SK: "META",
  };
  patch(key, {
    data: {
      ...order,
      guestSessionId: other.guestSessionId,
      tableId: other.tableId,
    },
  });
  const response = await read("session-orders");
  expect(response.statusCode).toBe(409);
  expect(response.body).not.toContain(order.orderId);
  patch(key, { data: { ...order, tableId: other.tableId } });
  for (const name of ["get-order", "order-items"] as const)
    expect((await read(name)).statusCode).toBe(409);
  patch(key, { data: { ...order, guestSessionId: fixtureId(99999) } });
  for (const name of ["get-order", "order-items"] as const)
    expect((await read(name)).statusCode).toBe(404);
});
test("a CLOSED Order in an OPEN visit remains readable; closing the visit removes waiter content only", async () => {
  f.items[4] = await Config.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: f.items[4].categoryId },
    f.items[4].id,
    { expectedVersion: 1, price: { amountMinor: 0, currency: "XOF" } },
  );
  const line = await add(4);
  await S.mutate(
    scope(),
    "SUBMIT_ORDER",
    {
      clientRequestId: request(),
      expectedVersion: 2,
      items: [{ itemId: line.itemId, expectedVersion: 1 }],
    },
    { orderId: order.orderId },
  );
  await S.mutate(
    scope(),
    "CLOSE_ORDER",
    { clientRequestId: request(), expectedVersion: 3 },
    { orderId: order.orderId },
  );
  for (const name of reads) expect((await read(name)).statusCode).toBe(200);
  expect(JSON.parse((await read("get-order")).body).data.status).toBe("CLOSED");
  const current = (await S.session(scope(), session.guestSessionId)).data;
  await S.mutate(
    scope(),
    "CLOSE_SESSION",
    { clientRequestId: request(), expectedVersion: current.version },
    { sessionId: session.guestSessionId },
  );
  for (const name of reads) expect((await read(name)).statusCode).toBe(404);
  const ended = await call(
    "get-session",
    "Aissa",
    {},
    { sessionId: session.guestSessionId },
  );
  expect(ended.statusCode).toBe(200);
  expect(JSON.parse(ended.body).data.status).toBe("CLOSED");
});
