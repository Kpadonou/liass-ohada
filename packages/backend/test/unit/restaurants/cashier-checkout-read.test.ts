import { RESTAURANT_TRANSACTION_ROUTES } from "@/lambda/domains/restaurants/transaction-routes";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  GetItemCommand,
  QueryCommand,
  BatchGetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { restaurantStaffHandler } from "@/lambda/domains/restaurants/staff-handler";
import { restaurantPreparationHandler } from "@/lambda/domains/restaurants/preparation-handler";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId as id } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  session: c.GuestSession,
  order: c.RestaurantOrder,
  seq: number;
const org = "org-resto";
const req = () => id(++seq);
const ctx = () => ({ orgId: org, outletId: f.outlet.id, actorId: "owner" });
const event = (
  actor: string,
  paths: object = {},
  query: object = {},
  body: object = {},
  tenant = org,
) => ({
  headers: { "x-org-id": tenant, "accept-language": "en" },
  pathParameters: { outletId: f.outlet.id, ...paths },
  queryStringParameters: query,
  body: JSON.stringify(body),
  requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
});
const call = (
  name: string,
  paths: object = {},
  query: object = {},
  actor = "cashier",
  body = {},
) => {
  const route = RESTAURANT_TRANSACTION_ROUTES.find(
    (route) => route.name === name,
  )!;
  const raw = event(actor, paths, query, body);
  raw.pathParameters = Object.fromEntries(
    [...route.path.matchAll(/\{(\w+)\}/g)].map((match) => [
      match[1],
      (raw.pathParameters as Record<string, unknown>)[match[1]],
    ]),
  ) as typeof raw.pathParameters;
  return restaurantTransactionHandler(name)(raw);
};
const read = (name: string, actor = "cashier") =>
  call(
    name,
    name === "get-session" || name === "session-orders"
      ? { sessionId: session.guestSessionId }
      : { orderId: order.orderId },
    {},
    actor,
  );
const patch = (
  key: { PK: string; SK: string },
  change: (
    raw: Record<string, unknown> & {
      data: Record<string, unknown>;
      productRoles: Record<string, string>;
    },
  ) => void,
) => {
  const k = JSON.stringify([key.PK, key.SK]);
  const row = unmarshall(m.rows.get(k)!);
  change(row as Parameters<typeof change>[0]);
  m.rows.set(k, marshall(row, { removeUndefinedValues: true }));
};
async function person(actor: string, role: string, assigned = true) {
  m.seedAccess(org, actor, role);
  await Staff.mutate(org, "owner", actor, "BIND", {
    clientRequestId: req(),
    memberUserId: actor,
    operationalLabel: `${actor} staff`,
  });
  if (assigned)
    await Staff.mutate(
      org,
      "owner",
      actor,
      "ASSIGN",
      { clientRequestId: req() },
      f.outlet.id,
    );
}
async function newOrder(type: "DINE_IN" | "COUNTER" | "TAKEAWAY" = "DINE_IN") {
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: type,
        ...(type === "DINE_IN"
          ? { guestSessionId: session.guestSessionId }
          : {}),
      })
    ).data,
  );
}
async function add(orderId = order.orderId, index = 0) {
  const current = await S.order(ctx(), orderId),
    item = f.items[index];
  return c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        ctx(),
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: current.data.version,
          menuItemId: item.id,
          categoryId: item.categoryId,
          expectedMenuItemVersion: item.version,
          quantity: 2,
        },
        { orderId },
      )
    ).data,
  );
}
async function submit(line: c.RestaurantOrderItem) {
  const o = await S.order(ctx(), line.orderId);
  await S.mutate(
    ctx(),
    "SUBMIT_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: o.data.version,
      items: [{ itemId: line.itemId, expectedVersion: line.version }],
    },
    { orderId: line.orderId },
  );
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 51000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("cashier", "CASHIER");
  await person("waiter", "WAITER");
  await person("cook", "KITCHEN");
  session = c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx(), "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: f.tables[0].id,
        areaId: f.tables[0].serviceAreaId,
      })
    ).data,
  );
  order = await newOrder();
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test("assigned cashier discovers outlets and FREE/OCCUPIED floor with canonical financial session context", async () => {
  const clean = event("cashier");
  clean.pathParameters = {} as typeof clean.pathParameters;
  const outlets = await restaurantStaffHandler("my-service-outlets")(clean);
  expect(outlets.statusCode).toBe(200);
  expect(
    c.RestaurantMyOutletsResponseSchema.parse(JSON.parse(outlets.body)).items,
  ).toEqual([{ outletId: f.outlet.id, name: f.outlet.name }]);
  const floor = await call("service-floor");
  expect(floor.statusCode).toBe(200);
  const page = c.RestaurantServiceFloorResponseSchema.parse(
    JSON.parse(floor.body),
  );
  expect(page.items.find((t) => t.tableId === session.tableId)).toMatchObject({
    name: f.tables[0].name,
    state: "OCCUPIED",
    guestSessionId: session.guestSessionId,
    currentAmountMinor: 0,
    currency: "XOF",
  });
  expect(page.items.some((t) => t.state === "FREE")).toBe(true);
  const detail = await read("get-session");
  expect(detail.statusCode).toBe(200);
  expect(JSON.parse(detail.body).data).toMatchObject({
    tableName: session.tableName,
    status: "OPEN",
    dueMinor: 0,
    paidMinor: 0,
    reservedMinor: 0,
    pendingPaymentCount: 0,
    orderCount: 1,
    openOrderCount: 1,
  });
});

test.each(["owner", "manager", "waiter"])(
  "%s existing reads remain valid without new checkout grants for waiter",
  async (actor) => {
    for (const name of [
      "get-session",
      "session-orders",
      "get-order",
      "order-items",
    ])
      expect((await read(name, actor)).statusCode).toBe(200);
    if (actor === "waiter")
      expect(Auth.permissionsForRestaurantsRole("WAITER")).not.toContain(
        "RESTAURANTS_CHECKOUT_READ",
      );
  },
);

test("cashier reads immutable sale/cancellation snapshots, never draft payable lines; warns through existing draft count", async () => {
  const accepted = await add();
  await submit(accepted);
  await add();
  const orders = await read("session-orders");
  expect(orders.statusCode).toBe(200);
  expect(JSON.parse(orders.body).items[0].draftLineCount).toBe(1);
  const lines = await read("order-items");
  expect(lines.statusCode).toBe(200);
  const items = c.RestaurantOrderItemListResponseSchema.parse(
    JSON.parse(lines.body),
  ).items;
  expect(items).toHaveLength(1);
  expect(items[0].snapshot).toMatchObject({
    name: f.items[0].name,
    quantity: 2,
    unitPriceMinor: f.items[0].price.amountMinor,
  });
  const o = await S.order(ctx(), order.orderId),
    l = await S.line(ctx(), order.orderId, accepted.itemId);
  await S.mutate(
    ctx(),
    "CANCEL_ITEM",
    {
      clientRequestId: req(),
      expectedVersion: o.data.version,
      expectedItemVersion: l.data.version,
      reason: "Correction",
    },
    { orderId: order.orderId, itemId: accepted.itemId },
  );
  expect(JSON.parse((await read("order-items")).body).items[0]).toMatchObject({
    status: "CANCELLED",
    snapshot: items[0].snapshot,
  });
});

test("filtered draft-only pages retain a continuation and cross-Order cursors fail closed", async () => {
  const lines = [await add(), await add()].sort((a, b) =>
    a.itemId.localeCompare(b.itemId),
  );
  await submit(lines[1]);
  const first = await call(
    "order-items",
    { orderId: order.orderId },
    { limit: 1 },
  );
  expect(first.statusCode).toBe(200);
  const page = JSON.parse(first.body);
  expect(page.items).toHaveLength(0);
  expect(page.nextCursor).toBeDefined();
  const next = await call(
    "order-items",
    { orderId: order.orderId },
    { limit: 1, cursor: page.nextCursor },
  );
  expect(JSON.parse(next.body).items).toHaveLength(1);
  const sibling = await newOrder();
  expect(
    (
      await call(
        "order-items",
        { orderId: sibling.orderId },
        { limit: 1, cursor: page.nextCursor },
      )
    ).statusCode,
  ).toBe(400);
});

test.each(["COUNTER", "TAKEAWAY"] as const)(
  "cashier cannot discover standalone %s Orders in this lot",
  async (type) => {
    const o = await newOrder(type);
    expect((await call("get-order", { orderId: o.orderId })).statusCode).toBe(
      404,
    );
    expect((await call("order-items", { orderId: o.orderId })).statusCode).toBe(
      404,
    );
  },
);

test("closed sessions deny cashier reads while management and prior waiter session semantics remain", async () => {
  patch(
    {
      PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
      SK: "META",
    },
    (r) => {
      r.data.status = "CLOSED";
      r.data.closedAt = new Date().toISOString();
      r.data.closedBy = "owner";
      r.data.openOrderCount = 0;
    },
  );
  for (const name of [
    "get-session",
    "session-orders",
    "get-order",
    "order-items",
  ]) {
    expect((await read(name)).statusCode).toBe(404);
    expect((await read(name, "owner")).statusCode).toBe(200);
  }
  expect((await read("get-session", "waiter")).statusCode).toBe(200);
});

test.each([
  "staff",
  "assignment",
  "deleted-assignment",
  "membership",
  "product",
  "role",
  "outlet",
])("%s revocation denies every cashier read without writes", async (kind) => {
  if (kind === "staff")
    patch(SR.staffKey(org, "cashier"), (r) => (r.data.status = "INACTIVE"));
  if (kind === "assignment")
    patch(
      SR.assignmentKeys(org, "cashier", f.outlet.id)[0],
      (r) => (r.data.status = "INACTIVE"),
    );
  if (kind === "deleted-assignment") {
    const k = SR.assignmentKeys(org, "cashier", f.outlet.id)[0];
    m.rows.delete(JSON.stringify([k.PK, k.SK]));
  }
  if (kind === "membership")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("cashier") },
      (r) => (r.status = "INACTIVE"),
    );
  if (kind === "product")
    patch(
      { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
      (r) => (r.status = "INACTIVE"),
    );
  if (kind === "role")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("cashier") },
      (r) => (r.productRoles.RESTAURANTS = "KITCHEN"),
    );
  if (kind === "outlet")
    patch(
      { PK: K.orgKey(org), SK: K.restaurantOutletSK(f.outlet.id) },
      (r) => (r.data.isActive = false),
    );
  m.db.resetHistory();
  for (const name of [
    "get-session",
    "session-orders",
    "get-order",
    "order-items",
  ])
    expect((await read(name)).statusCode).toBe(403);
  expect((await call("service-floor")).statusCode).toBe(403);
  expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  expect(m.db.commandCalls(QueryCommand)).toHaveLength(0);
});

test("unknown tenant/outlet/session/Order and unassigned/missing staff fail safely", async () => {
  await person("unassigned", "CASHIER", false);
  m.seedAccess(org, "missing", "CASHIER");
  for (const actor of ["unassigned", "missing", "cook"])
    expect((await read("get-session", actor)).statusCode).toBe(403);
  expect(
    (
      await call("get-session", {
        outletId: id(999),
        sessionId: session.guestSessionId,
      })
    ).statusCode,
  ).toBe(403);
  expect((await call("get-session", { sessionId: id(998) })).statusCode).toBe(
    404,
  );
  expect((await call("get-order", { orderId: id(997) })).statusCode).toBe(404);
  expect(
    (
      await restaurantTransactionHandler("get-session")(
        event(
          "cashier",
          { sessionId: session.guestSessionId },
          {},
          {},
          "foreign",
        ),
      )
    ).statusCode,
  ).toBe(403);
});

test("cashier checkout capability never authorizes service/Preparation/exception handlers", async () => {
  const permissions = Auth.permissionsForRestaurantsRole("CASHIER");
  expect(permissions).toContain("RESTAURANTS_CHECKOUT_READ");
  expect(permissions).not.toContain("RESTAURANTS_SERVICE_FLOOR_READ");
  const bodies: Record<string, object> = {
    "open-session": {
      clientRequestId: req(),
      tableId: f.tables[1].id,
      areaId: f.tables[1].serviceAreaId,
    },
    "create-order": {
      clientRequestId: req(),
      orderType: "DINE_IN",
      guestSessionId: session.guestSessionId,
    },
    "add-draft-item": {
      clientRequestId: req(),
      expectedVersion: 1,
      menuItemId: f.items[0].id,
      categoryId: f.items[0].categoryId,
      expectedMenuItemVersion: 1,
      quantity: 1,
    },
    "edit-draft-item": {
      clientRequestId: req(),
      expectedVersion: 1,
      expectedItemVersion: 1,
      quantity: 2,
      menuItemId: f.items[0].id,
      categoryId: f.items[0].categoryId,
      expectedMenuItemVersion: 1,
    },
    "cancel-order-item": {
      clientRequestId: req(),
      expectedVersion: 1,
      expectedItemVersion: 1,
      reason: "Correction",
    },
    "submit-order": {
      clientRequestId: req(),
      expectedVersion: 1,
      items: [{ itemId: id(995), expectedVersion: 1 }],
    },
    "cancel-order": {
      clientRequestId: req(),
      expectedVersion: 1,
      reason: "No",
    },
    "replace-responsible-staff": {
      clientRequestId: req(),
      expectedVersion: 1,
      staffId: "cashier",
    },
  };
  m.db.resetHistory();
  for (const [name, body] of Object.entries(bodies))
    expect(
      (
        await call(
          name,
          {
            sessionId: session.guestSessionId,
            orderId: order.orderId,
            itemId: id(995),
          },
          {},
          "cashier",
          body,
        )
      ).statusCode,
    ).toBe(403);
  for (const name of [
    "active-sessions",
    "active-orders",
    "unpaid-orders",
    "session-history",
    "order-history",
    "table-orders",
    "table-session-history",
    "active-table-session",
  ])
    expect(
      (
        await call(
          name,
          { tableId: session.tableId },
          name.includes("history")
            ? {
                start: "2026-10-01T00:00:00.000Z",
                end: "2026-10-02T00:00:00.000Z",
              }
            : {},
        )
      ).statusCode,
    ).toBe(403);
  for (const name of [
    "start-preparation",
    "ready-preparation",
    "serve-preparation",
  ])
    expect(
      (
        await restaurantPreparationHandler(name)(
          event(
            "cashier",
            { orderId: order.orderId, itemId: id(995), fireId: id(996) },
            {},
            { clientRequestId: req(), expectedVersion: 1 },
          ),
        )
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await restaurantPreparationHandler("order-preparation")(
        event("cashier", { orderId: order.orderId }),
      )
    ).statusCode,
  ).toBe(403);
  expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test.each([1, 3, 10])(
  "cold checkout data reads remain bounded for %s Orders",
  async (count) => {
    await add();
    for (let i = 1; i < count; i++) {
      const o = await newOrder();
      await add(o.orderId);
    }
    m.db.resetHistory();
    const selfEvent = event("cashier");
    selfEvent.pathParameters = {} as typeof selfEvent.pathParameters;
    expect(
      (await restaurantStaffHandler("my-service-outlets")(selfEvent))
        .statusCode,
    ).toBe(200);
    expect((await call("service-floor")).statusCode).toBe(200);
    expect((await read("get-session")).statusCode).toBe(200);
    const list = await read("session-orders");
    expect(list.statusCode).toBe(200);
    for (const o of JSON.parse(list.body).items)
      expect(
        (await call("order-items", { orderId: o.orderId })).statusCode,
      ).toBe(200);
    expect({
      get: m.db.commandCalls(GetItemCommand).length,
      query: m.db.commandCalls(QueryCommand).length,
      batch: m.db.commandCalls(BatchGetItemCommand).length,
    }).toEqual({ get: 37 + 13 * count, query: 3 + count, batch: 4 });
    expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
    expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  },
);
