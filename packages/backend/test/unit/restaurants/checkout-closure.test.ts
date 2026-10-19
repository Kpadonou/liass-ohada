import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantTransactionsService as S } from "@/lambda/domains/restaurants/transaction-service";
import { RestaurantTransactionsRepository as R } from "@/lambda/domains/restaurants/transaction-repository";
import { RestaurantPaymentService as Pay } from "@/lambda/domains/restaurants/payment-service";
import { RestaurantPreparationService as Prep } from "@/lambda/domains/restaurants/preparation-service";
import { RestaurantTransactionQueries as Q } from "@/lambda/domains/restaurants/transaction-queries";
import { RestaurantsService as Config } from "@/lambda/domains/restaurants/restaurant-service";
import { restaurantTransactionHandler } from "@/lambda/domains/restaurants/transaction-handler";
import { RestaurantStaffService as Staff } from "@/lambda/domains/restaurants/staff-service";
import { RestaurantStaffRepository as SR } from "@/lambda/domains/restaurants/staff-repository";
import { DomainAuthorizationService as Auth } from "@/lambda/shared/services/domain-authorization-service";
import { acceptanceFixture } from "./acceptance-fixture";
import { memoryDynamo, fixtureId as id } from "./memory-dynamo";
let m: ReturnType<typeof memoryDynamo>,
  f: Awaited<ReturnType<typeof acceptanceFixture>>,
  session: c.GuestSession,
  seq: number;
const org = "org-resto",
  req = () => id(++seq);
const scope = () => ({ orgId: org, outletId: f.outlet.id });
const ctx = (actorId = "owner") => ({ ...scope(), actorId });
const sessionKey = () => ({
  PK: K.restaurantSessionPK(org, f.outlet.id, session.guestSessionId),
  SK: K.restaurantTransactionMetaSK(),
});
const orderKey = (orderId: string) => ({
  PK: K.restaurantOrderPK(org, f.outlet.id, orderId),
  SK: K.restaurantTransactionMetaSK(),
});
const patch = (
  key: { PK: string; SK: string },
  update: (raw: Record<string, unknown>) => void,
) => {
  const k = JSON.stringify([key.PK, key.SK]),
    row = unmarshall(m.rows.get(k)!);
  update(row);
  m.rows.set(k, marshall(row, { removeUndefinedValues: true }));
};
const patchData = (key: { PK: string; SK: string }, update: object) =>
  patch(key, (raw) => Object.assign(raw.data as object, update));
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
async function add(orderId: string, index = 4) {
  const o = await S.order(scope(), orderId),
    item = f.items[index];
  return c.RestaurantOrderItemSchema.parse(
    (
      await S.mutate(
        ctx(),
        "ADD_ITEM",
        {
          clientRequestId: req(),
          expectedVersion: o.data.version,
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
  const o = await S.order(scope(), line.orderId);
  return c.RestaurantOrderSchema.parse(
    (
      await S.mutate(
        ctx(),
        "SUBMIT_ORDER",
        {
          clientRequestId: req(),
          expectedVersion: o.data.version,
          items: [{ itemId: line.itemId, expectedVersion: line.version }],
        },
        { orderId: line.orderId },
      )
    ).data,
  );
}
async function create(index = 4, accepted = true, actor = "owner") {
  const o = c.RestaurantOrderSchema.parse(
    (
      await S.mutate(ctx(actor), "CREATE_ORDER", {
        clientRequestId: req(),
        orderType: "DINE_IN",
        guestSessionId: session.guestSessionId,
      })
    ).data,
  );
  if (!accepted) return o;
  return submit(await add(o.orderId, index));
}
async function pay(orders: c.RestaurantOrder[]) {
  const current = await S.session(scope(), session.guestSessionId);
  const allocations = [];
  for (const o of orders) {
    const currentOrder = await S.order(scope(), o.orderId);
    const amountMinor =
      currentOrder.data.dueMinor - currentOrder.data.paidMinor;
    if (amountMinor) allocations.push({ orderId: o.orderId, amountMinor });
  }
  return Pay.capture(scope(), "cashier", session.guestSessionId, {
    clientRequestId: req(),
    expectedVersion: current.data.version,
    method: "CARD",
    currency: "XOF",
    allocations,
  });
}
async function closeBody(orderId?: string) {
  return {
    clientRequestId: req(),
    expectedVersion: orderId
      ? (await S.order(scope(), orderId)).data.version
      : (await S.session(scope(), session.guestSessionId)).data.version,
  };
}
function call(
  orderId: string | undefined,
  body: object,
  actor = "cashier",
  outletId = f.outlet.id,
  ownerId = session.guestSessionId,
  tenant = org,
) {
  return restaurantTransactionHandler(
    orderId ? "close-order" : "close-session",
  )({
    headers: { "x-org-id": tenant, "accept-language": "en" },
    pathParameters: {
      outletId,
      ...(orderId ? { orderId } : { sessionId: ownerId }),
    },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: actor } } } },
  });
}
const closeOrder = async (orderId: string, actor = "cashier", body?: object) =>
  call(orderId, body ?? (await closeBody(orderId)), actor);
const closeSession = async (actor = "cashier", body?: object) =>
  call(undefined, body ?? (await closeBody()), actor);
const state = async () =>
  (await S.session(scope(), session.guestSessionId)).data;
const occupied = async () =>
  expect(
    (await S.activeTable(scope(), session.tableId)).data?.guestSessionId,
  ).toBe(session.guestSessionId);
async function zeroMenu() {
  f.items[4] = await Config.update(
    org,
    "owner",
    "item",
    { outletId: f.outlet.id, categoryId: f.items[4].categoryId },
    f.items[4].id,
    {
      expectedVersion: f.items[4].version,
      price: { amountMinor: 0, currency: "XOF" },
    },
    "update",
  );
}
async function transitionAll(
  orderId: string,
  until: "IN_PROGRESS" | "READY" | "SERVED",
) {
  const page = await R.query(
    scope(),
    orderKey(orderId).PK,
    K.restaurantPreparationPrefix(),
    "PREPARATION",
    { limit: 100 },
  );
  for (const row of page.rows) {
    if (row.entityType !== "RESTAURANT_PREPARATION")
      throw new Error("Unexpected task");
    let task = row.data;
    for (const [command, target] of [
      ["START", "IN_PROGRESS"],
      ["READY", "READY"],
      ["SERVE", "SERVED"],
    ] as const) {
      if (task.state === target) {
        if (target === until) break;
        continue;
      }
      if (
        (command === "START" && task.state !== "QUEUED") ||
        (command === "READY" && task.state !== "IN_PROGRESS") ||
        (command === "SERVE" && task.state !== "READY")
      )
        continue;
      task = (
        await Prep.transition(
          scope(),
          "owner",
          command,
          { clientRequestId: req(), expectedVersion: task.version },
          { orderId, itemId: task.itemId, fireId: task.fireId },
        )
      ).data;
      if (task.state === until) break;
    }
  }
}
beforeEach(async () => {
  m = memoryDynamo();
  seq = 145000;
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  f = await acceptanceFixture();
  m.seedAccess(org, "owner", "OWNER");
  m.seedAccess(org, "manager", "MANAGER");
  await person("cashier", "CASHIER");
  await person("cashier2", "CASHIER");
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
});
afterEach(() => {
  m.db.restore();
  jest.restoreAllMocks();
});

test.each(["owner", "manager", "cashier"])(
  "%s composes multiple canonical closes and final atomic table release",
  async (actor) => {
    const orders = [await create(), await create(), await create(0)];
    await pay(orders);
    await transitionAll(orders[2].orderId, "SERVED");
    for (const o of orders)
      expect((await closeOrder(o.orderId, actor)).statusCode).toBe(200);
    expect(await state()).toMatchObject({
      status: "OPEN",
      openOrderCount: 0,
      dueMinor: 18000,
      paidMinor: 18000,
    });
    await occupied();
    expect((await closeSession(actor)).statusCode).toBe(200);
    expect((await state()).status).toBe("CLOSED");
    expect((await S.activeTable(scope(), session.tableId)).data).toBeNull();
    expect(
      await R.get(
        scope(),
        {
          PK: K.restaurantTransactionActivePK(org, f.outlet.id, "GS"),
          SK: K.restaurantTransactionLocatorSK(
            session.openedAt,
            session.guestSessionId,
          ),
        },
        "ACTIVE_SESSION",
      ),
    ).toBeUndefined();
  },
);
test.each(["owner", "cashier"])(
  "%s exact Order/session action counts stay bounded, including responsibility locator",
  async (actor) => {
    await zeroMenu();
    const normal = await create(),
      attributed = await create(4, true, "waiter");
    for (const [o, business] of [
      [normal, 8],
      [attributed, 9],
    ] as const) {
      m.db.resetHistory();
      expect((await closeOrder(o.orderId, actor)).statusCode).toBe(200);
      const actions = m.db.commandCalls(TransactWriteItemsCommand)[0].args[0]
        .input.TransactItems!;
      expect(actions).toHaveLength(business + (actor === "cashier" ? 5 : 2));
      expect(Buffer.byteLength(JSON.stringify(actions))).toBeLessThan(
        3 * 1024 * 1024,
      );
      console.log("CLOSE_ORDER_BOUND", {
        actor,
        attributed: o === attributed,
        actions: actions.length,
        bytes: Buffer.byteLength(JSON.stringify(actions)),
      });
    }
    m.db.resetHistory();
    expect((await closeSession(actor)).statusCode).toBe(200);
    const actions = m.db.commandCalls(TransactWriteItemsCommand)[0].args[0]
      .input.TransactItems!;
    expect(actions).toHaveLength(6 + (actor === "cashier" ? 5 : 2));
    console.log("CLOSE_SESSION_BOUND", {
      actor,
      actions: actions.length,
      bytes: Buffer.byteLength(JSON.stringify(actions)),
    });
  },
);
test("unpaid balance and open Orders block closure without releasing table", async () => {
  const o = await create();
  expect((await closeOrder(o.orderId)).statusCode).toBe(409);
  expect((await closeSession()).statusCode).toBe(409);
  await occupied();
  await pay([o]);
  expect((await closeSession()).statusCode).toBe(409);
  expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await closeSession()).statusCode).toBe(200);
});
test("QUEUED/IN_PROGRESS/READY block closure; SERVE permits later explicit close", async () => {
  const o = await create(0);
  await pay([o]);
  for (const target of [undefined, "IN_PROGRESS", "READY"] as const) {
    if (target) await transitionAll(o.orderId, target);
    expect((await closeOrder(o.orderId)).statusCode).toBe(409);
    expect((await closeSession()).statusCode).toBe(409);
    await occupied();
  }
  const stale = await closeBody(o.orderId);
  const [, concurrentClose] = await Promise.all([
    transitionAll(o.orderId, "SERVED"),
    closeOrder(o.orderId, "cashier", stale),
  ]);
  expect(concurrentClose.statusCode).toBe(409);
  expect((await state()).status).toBe("OPEN");
  await occupied();
  expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await closeSession()).statusCode).toBe(200);
});
test("drafts are retained and empty never-accepted draft requires existing management resolution", async () => {
  const o = await create();
  await pay([o]);
  const draft = await add(o.orderId);
  const before = new Map(m.rows);
  expect((await closeOrder(o.orderId)).statusCode).toBe(409);
  expect(m.rows).toEqual(before);
  expect((await S.line(scope(), o.orderId, draft.itemId)).data.status).toBe(
    "DRAFT",
  );
  const empty = await create(4, false);
  expect((await closeOrder(empty.orderId)).statusCode).toBe(409);
  const denied = await restaurantTransactionHandler("cancel-order")({
    headers: { "x-org-id": org },
    pathParameters: { outletId: f.outlet.id, orderId: empty.orderId },
    body: JSON.stringify({
      clientRequestId: req(),
      expectedVersion: empty.version,
      reason: "Resolve empty draft",
    }),
    requestContext: { authorizer: { jwt: { claims: { sub: "cashier" } } } },
  });
  expect(denied.statusCode).toBe(403);
});
test.each(["reservedMinor", "pendingPaymentCount"])(
  "%s remains an authoritative blocker",
  async (field) => {
    const o = await create();
    if (field === "pendingPaymentCount") await pay([o]);
    patchData(orderKey(o.orderId), { [field]: 1 });
    patchData(sessionKey(), { [field]: 1 });
    expect((await closeOrder(o.orderId)).statusCode).toBe(409);
    expect((await closeSession()).statusCode).toBe(409);
    await occupied();
  },
);
test("fifty-Order partial progress survives failure and resumes without rollback or duplicate decrements", async () => {
  await zeroMenu();
  const orders = [];
  for (let i = 0; i < 50; i++) orders.push(await create());
  const draft = await add(orders[23].orderId);
  for (const o of orders.slice(0, 23))
    expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await closeOrder(orders[23].orderId)).statusCode).toBe(409);
  expect(await state()).toMatchObject({ status: "OPEN", openOrderCount: 27 });
  await occupied();
  const current = await S.order(scope(), draft.orderId);
  await S.mutate(
    ctx(),
    "CANCEL_ITEM",
    {
      clientRequestId: req(),
      expectedVersion: current.data.version,
      expectedItemVersion: draft.version,
      reason: "Explicit draft removal",
    },
    { orderId: draft.orderId, itemId: draft.itemId },
  );
  const page = await Q.run(
    scope(),
    "SESSION_ORDERS",
    { limit: 100 },
    { sessionId: session.guestSessionId },
    true,
    true,
  );
  const remaining = page.items
    .map((o) => c.RestaurantOrderSchema.parse(o))
    .filter((o) => o.status !== "CLOSED" && o.status !== "CANCELLED");
  expect(remaining).toHaveLength(27);
  for (const o of remaining)
    expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await state()).openOrderCount).toBe(0);
  await occupied();
  expect((await closeSession()).statusCode).toBe(200);
  expect(m.db.commandCalls(ScanCommand)).toHaveLength(0);
}, 30000);
test("same-intent concurrent retries replay; different cashiers conflict without double decrement/release", async () => {
  await zeroMenu();
  const o = await create();
  const a = await closeBody(o.orderId),
    b = await closeBody(o.orderId);
  const results = await Promise.all([
    call(o.orderId, a),
    call(o.orderId, b, "cashier2"),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect((await state()).openOrderCount).toBe(0);
  await occupied();
  const first =
    results[0].statusCode === 200
      ? { body: a, actor: "cashier" }
      : { body: b, actor: "cashier2" };
  expect((await call(o.orderId, first.body, first.actor)).statusCode).toBe(200);
  const final = await closeBody();
  const closed = await Promise.all([
    call(undefined, final),
    call(undefined, final),
  ]);
  expect(closed.every((r) => r.statusCode === 200)).toBe(true);
  expect(JSON.parse(closed[0].body)).toEqual(JSON.parse(closed[1].body));
  const before = new Map(m.rows);
  expect((await call(o.orderId, first.body, first.actor)).statusCode).toBe(200);
  expect(m.rows).toEqual(before);
});
test("different cashier final-close intents cannot double release occupancy", async () => {
  const a = await closeBody(),
    b = await closeBody();
  const results = await Promise.all([
    call(undefined, a),
    call(undefined, b, "cashier2"),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect((await S.activeTable(scope(), session.tableId)).data).toBeNull();
});
test("lost final response recovers durable CLOSED result after occupancy disappeared", async () => {
  const body = await closeBody(),
    original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await original(actions);
    throw new Error("Lost response");
  });
  const first = await call(undefined, body);
  expect(first.statusCode).toBe(200);
  const before = new Map(m.rows);
  expect(await call(undefined, body)).toEqual(first);
  expect(m.rows).toEqual(before);
  expect(
    (
      await call(undefined, {
        ...body,
        expectedVersion: body.expectedVersion + 1,
      })
    ).statusCode,
  ).toBe(409);
});
test.each([
  "staff",
  "assignment",
  "deleted-assignment",
  "membership",
  "product",
  "role",
  "outlet",
])("%s revocation denies new close and durable replay", async (kind) => {
  await zeroMenu();
  const o = await create(),
    body = await closeBody(o.orderId);
  expect((await call(o.orderId, body)).statusCode).toBe(200);
  if (kind === "staff")
    patchData(SR.staffKey(org, "cashier"), { status: "INACTIVE" });
  if (kind === "assignment")
    patchData(SR.assignmentKeys(org, "cashier", f.outlet.id)[0], {
      status: "INACTIVE",
    });
  if (kind === "deleted-assignment") {
    const key = SR.assignmentKeys(org, "cashier", f.outlet.id)[0];
    m.rows.delete(JSON.stringify([key.PK, key.SK]));
  }
  if (kind === "membership")
    patch(
      { PK: K.orgKey(org), SK: K.orgUserAccessSK("cashier") },
      (raw) => (raw.status = "INACTIVE"),
    );
  if (kind === "product")
    patch(
      { PK: K.orgKey(org), SK: K.productAccessSK("RESTAURANTS") },
      (raw) => (raw.status = "INACTIVE"),
    );
  if (kind === "role") m.seedAccess(org, "cashier", "WAITER");
  if (kind === "outlet")
    patchData(
      { PK: K.orgKey(org), SK: K.restaurantOutletSK(f.outlet.id) },
      { isActive: false },
    );
  const before = new Map(m.rows);
  m.db.resetHistory();
  expect((await call(o.orderId, body)).statusCode).toBe(403);
  expect((await closeSession()).statusCode).toBe(403);
  expect(m.rows).toEqual(before);
  expect(m.db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test.each(["waiter", "cook", "missing", "invalid"])(
  "%s cannot invoke closure handlers or direct service",
  async (actor) => {
    m.seedAccess(org, "missing", "CASHIER");
    m.seedAccess(org, "invalid", "INVALID");
    await zeroMenu();
    const o = await create(),
      body = await closeBody(o.orderId);
    expect((await call(o.orderId, body, actor)).statusCode).toBe(403);
    expect((await closeSession(actor)).statusCode).toBe(403);
    await expect(
      S.mutate(ctx(actor), "CLOSE_ORDER", body, { orderId: o.orderId }),
    ).rejects.toMatchObject({ statusCode: 403 });
  },
);
test("unassigned/foreign organization/outlet and malformed parent relationships fail closed", async () => {
  await person("unassigned", "CASHIER", false);
  await zeroMenu();
  const o = await create(),
    body = await closeBody(o.orderId);
  expect((await call(o.orderId, body, "unassigned")).statusCode).toBe(403);
  expect((await call(o.orderId, body, "cashier", id(100))).statusCode).toBe(
    403,
  );
  expect(
    (
      await call(
        o.orderId,
        body,
        "cashier",
        f.outlet.id,
        session.guestSessionId,
        "foreign",
      )
    ).statusCode,
  ).toBe(403);
  expect((await call(id(101), body)).statusCode).toBe(404);
  expect(
    (await call(undefined, await closeBody(), "cashier", f.outlet.id, id(102)))
      .statusCode,
  ).toBe(404);
  patchData(orderKey(o.orderId), { tableId: f.tables[1].id });
  expect((await call(o.orderId, body)).statusCode).toBe(404);
  patchData(orderKey(o.orderId), {
    tableId: session.tableId,
    guestSessionId: id(103),
  });
  expect((await call(o.orderId, body)).statusCode).toBe(404);
  await occupied();
});
test.each(["TAKEAWAY", "COUNTER"] as const)(
  "cashier scoped closure excludes %s while management semantics remain",
  async (orderType) => {
    const o = c.RestaurantOrderSchema.parse(
      (
        await S.mutate(ctx(), "CREATE_ORDER", {
          clientRequestId: req(),
          orderType,
        })
      ).data,
    );
    const accepted = await submit(await add(o.orderId));
    expect((await closeOrder(accepted.orderId)).statusCode).toBe(404);
  },
);
test("new Order/submission winning before final close keeps session OPEN/OCCUPIED", async () => {
  await zeroMenu();
  const body = await closeBody(),
    original = R.commit.bind(R);
  let added: c.RestaurantOrder | undefined;
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    added = await create();
    await original(actions);
  });
  expect((await call(undefined, body)).statusCode).toBe(409);
  expect((await state()).openOrderCount).toBe(1);
  await occupied();
  expect(added?.status).toBe("SUBMITTED");
});
test("final closure winning prevents later attached Orders/rounds/payment", async () => {
  await zeroMenu();
  const o = await create();
  expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await closeSession()).statusCode).toBe(200);
  const before = new Map(m.rows);
  await expect(create()).rejects.toMatchObject({ statusCode: 409 });
  await expect(add(o.orderId)).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    Pay.capture(scope(), "cashier", session.guestSessionId, {
      clientRequestId: req(),
      expectedVersion: (await state()).version,
      method: "CARD",
      currency: "XOF",
      allocations: [{ orderId: o.orderId, amountMinor: 1 }],
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(m.rows).toEqual(before);
});
test("concurrent draft addition invalidates stale Order close rather than discarding work", async () => {
  await zeroMenu();
  const o = await create(),
    body = await closeBody(o.orderId),
    original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    await add(o.orderId);
    await original(actions);
  });
  expect((await call(o.orderId, body)).statusCode).toBe(409);
  expect((await S.order(scope(), o.orderId)).data).toMatchObject({
    status: "SUBMITTED",
    draftLineCount: 1,
  });
  await occupied();
});
test("accepted cancellation serializes with closure and cancelled work does not block retry", async () => {
  await zeroMenu();
  const o = await create(),
    body = await closeBody(o.orderId),
    original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    const page = await S.allLines(scope(), o.orderId),
      current = await S.order(scope(), o.orderId),
      line = page[0];
    await S.mutate(
      ctx(),
      "CANCEL_ITEM",
      {
        clientRequestId: req(),
        expectedVersion: current.data.version,
        expectedItemVersion: line.version,
        reason: "Explicit correction",
      },
      { orderId: o.orderId, itemId: line.itemId },
    );
    await original(actions);
  });
  expect((await call(o.orderId, body)).statusCode).toBe(409);
  expect((await state()).openOrderCount).toBe(1);
  await occupied();
  expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await closeSession()).statusCode).toBe(200);
});
test("pre-feature routed acceptance without canonical fire evidence remains blocked", async () => {
  const o = await create(0);
  await pay([o]);
  const lines = await S.allLines(scope(), o.orderId);
  patch(
    orderKey(o.orderId),
    (raw) => delete (raw.data as Record<string, unknown>).outstandingWorkCount,
  );
  patch(
    {
      PK: orderKey(o.orderId).PK,
      SK: K.restaurantOrderItemSK(lines[0].itemId),
    },
    (raw) => {
      delete (raw.data as Record<string, unknown>).latestFireId;
      delete (raw.data as Record<string, unknown>).fireCount;
    },
  );
  const result = await closeOrder(o.orderId);
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error.code).toBe(
    "RESTAURANTS_PREPARATION_DEFERRED",
  );
  await occupied();
});
test("closure guards reject authorization revocation inside the transaction", async () => {
  await zeroMenu();
  const o = await create(),
    original = R.commit.bind(R);
  jest.spyOn(R, "commit").mockImplementationOnce(async (actions) => {
    patchData(SR.assignmentKeys(org, "cashier", f.outlet.id)[0], {
      status: "INACTIVE",
    });
    await original(actions);
  });
  expect((await closeOrder(o.orderId)).statusCode).toBe(403);
  expect((await state()).openOrderCount).toBe(1);
  await occupied();
});
test("management retains inactive-outlet closure without a new Staff/configuration prerequisite", async () => {
  await zeroMenu();
  const o = await create();
  patchData(
    { PK: K.orgKey(org), SK: K.restaurantOutletSK(f.outlet.id) },
    { isActive: false },
  );
  expect((await closeOrder(o.orderId, "manager")).statusCode).toBe(200);
  expect((await closeSession("owner")).statusCode).toBe(200);
});
test("closure is independent from checkout read/capture and does not grant service or cancellation", () => {
  for (const role of [
    "OWNER",
    "MANAGER",
    "CASHIER",
    "WAITER",
    "KITCHEN",
    undefined,
  ])
    expect(
      Auth.permissionsForRestaurantsRole(role).includes(
        "RESTAURANTS_CHECKOUT_CLOSE_MANAGE",
      ),
    ).toBe(["OWNER", "MANAGER", "CASHIER"].includes(role ?? ""));
  for (const permission of [
    "RESTAURANTS_CHECKOUT_READ",
    "RESTAURANTS_PAYMENT_CAPTURE_MANAGE",
  ] as const)
    expect(
      Auth.hasPermission([permission], "RESTAURANTS_CHECKOUT_CLOSE_MANAGE"),
    ).toBe(false);
  for (const permission of [
    "RESTAURANTS_ORDER_CANCEL_MANAGE",
    "RESTAURANTS_SERVICE_SESSION_OPEN_MANAGE",
    "RESTAURANTS_PREPARATION_SERVE_MANAGE",
  ] as const)
    expect(
      Auth.hasPermission(["RESTAURANTS_CHECKOUT_CLOSE_MANAGE"], permission),
    ).toBe(false);
});

test("terminalized Preparation and CANCELLED Orders are skipped without fictitious payment or SERVE", async () => {
  const routed = await create(0),
    lines = await S.allLines(scope(), routed.orderId),
    current = await S.order(scope(), routed.orderId);
  await S.mutate(
    ctx(),
    "CANCEL_ITEM",
    {
      clientRequestId: req(),
      expectedVersion: current.data.version,
      expectedItemVersion: lines[0].version,
      reason: "Explicit cancellation",
    },
    { orderId: routed.orderId, itemId: lines[0].itemId },
  );
  expect(
    (await S.order(scope(), routed.orderId)).data.outstandingWorkCount,
  ).toBe(0);
  const tasks = await R.query(
    scope(),
    orderKey(routed.orderId).PK,
    K.restaurantPreparationPrefix(),
    "PREPARATION",
    { limit: 100 },
  );
  expect(
    tasks.rows.every(
      (row) =>
        row.entityType === "RESTAURANT_PREPARATION" &&
        row.data.state === "CANCELLED",
    ),
  ).toBe(true);
  const empty = await create(4, false);
  await S.mutate(
    ctx(),
    "CANCEL_ORDER",
    {
      clientRequestId: req(),
      expectedVersion: empty.version,
      reason: "Resolve never-accepted empty draft",
    },
    { orderId: empty.orderId },
  );
  const body = await closeBody(routed.orderId);
  expect((await closeOrder(routed.orderId, "cashier", body)).statusCode).toBe(
    200,
  );
  const list = await Q.run(
    scope(),
    "SESSION_ORDERS",
    { limit: 100 },
    { sessionId: session.guestSessionId },
    true,
    true,
  );
  expect(
    list.items.map((row) => c.RestaurantOrderSchema.parse(row).status).sort(),
  ).toEqual(["CANCELLED", "CLOSED"]);
  expect((await state()).openOrderCount).toBe(0);
  expect((await closeSession()).statusCode).toBe(200);
});

test("old final-close replay cannot free a newly occupied visit at the same table", async () => {
  const body = await closeBody();
  expect((await closeSession("cashier", body)).statusCode).toBe(200);
  const next = c.GuestSessionSchema.parse(
    (
      await S.mutate(ctx(), "OPEN_SESSION", {
        clientRequestId: req(),
        tableId: session.tableId,
        areaId: session.areaId,
      })
    ).data,
  );
  const before = new Map(m.rows);
  expect((await closeSession("cashier", body)).statusCode).toBe(200);
  expect(m.rows).toEqual(before);
  expect(
    (await S.activeTable(scope(), session.tableId)).data?.guestSessionId,
  ).toBe(next.guestSessionId);
});

test("final close refuses an occupancy pointer owned by another visit", async () => {
  patchData(
    {
      PK: K.restaurantOccupancyPK(org, f.outlet.id, session.tableId),
      SK: K.restaurantOccupancySK(),
    },
    { guestSessionId: id(199999) },
  );
  const before = new Map(m.rows),
    response = await closeSession();
  expect(response.statusCode).toBe(409);
  expect(JSON.parse(response.body).error.code).toBe(
    "RESTAURANTS_TRANSACTION_INTEGRITY",
  );
  expect(m.rows).toEqual(before);
});

test("payment committing during Order-close reads leaves no stale financial replacement", async () => {
  const o = await create(),
    body = await closeBody(o.orderId),
    original = S.order.bind(S);
  jest.spyOn(S, "order").mockImplementationOnce(async (...args) => {
    const old = await original(...args);
    await pay([old.data]);
    return old;
  });
  expect((await call(o.orderId, body)).statusCode).toBe(409);
  expect(await state()).toMatchObject({
    status: "OPEN",
    dueMinor: 4000,
    paidMinor: 4000,
    openOrderCount: 1,
  });
  await occupied();
  expect((await closeOrder(o.orderId)).statusCode).toBe(200);
  expect((await closeSession()).statusCode).toBe(200);
});
